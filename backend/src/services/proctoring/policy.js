/**
 * Exam-level proctoring policy: schema (embedded in Exam / OlympiadExam), defaults, validation and the snapshot that is
 * frozen into a ProctoringSession when an attempt starts (so editing the exam never changes the rules mid-attempt).
 *
 * Defaults follow the LearnIQ rules:
 *   face absence     5 warnings -> the 5th confirmed warning auto-submits
 *   multiple faces   3 warnings -> the 3rd confirmed warning auto-submits
 *   mobile phone     2 warnings -> the NEXT (3rd) independent confirmed detection auto-submits
 *   tab switch / fullscreen exit: per `switchAction` (strict mode defaults to AUTO_SUBMIT_ON_CONFIRMED_SWITCH)
 */
const mongoose = require('mongoose');

const SWITCH_ACTIONS = ['WARN', 'WARN_AND_REQUIRE_FULLSCREEN', 'AUTO_SUBMIT_ON_CONFIRMED_SWITCH'];
const CAMERA_FAILURE_ACTIONS = ['BLOCK_UNTIL_RESTORED', 'AUTO_SUBMIT_AFTER_GRACE'];

/** [min, max, default] for every numeric setting - the single source of truth for validation and the UI. */
const NUMERIC = {
  maxFaceAbsenceWarnings: [1, 20, 5],
  maxMultiFaceWarnings: [1, 10, 3],
  maxPhoneWarnings: [0, 10, 2],
  faceAbsenceThresholdMs: [2000, 30000, 4000],   // no face for this long = one confirmed absence episode
  multiFacePersistenceMs: [1000, 15000, 2500],    // 2+ faces for this long = one confirmed episode
  phonePersistenceMs: [500, 10000, 1500],         // phone seen (above confidence) for this long = one confirmed episode
  phoneConfidence: [0.3, 0.95, 0.5],              // EfficientDet-Lite0 "cell phone" score
  recoveryMs: [500, 10000, 1500],                 // condition must be gone this long before a NEW episode can start
  fullscreenGraceMs: [3000, 60000, 10000],        // strict mode: not back in fullscreen within this = confirmed exit
  cameraGraceMs: [10000, 300000, 60000],          // AUTO_SUBMIT_AFTER_GRACE: camera not back within this = submit
  warningCooldownMs: [1000, 60000, 5000],         // server ignores a 2nd counted event of the same type within this
};

const BOOLEAN = {
  enabled: false,              // off for existing exams until a teacher / admin turns it on
  cameraRequired: true,
  faceMonitoring: true,
  multiFaceMonitoring: true,
  phoneDetection: true,
  fullscreenRequired: true,
  strictMode: false,
  desktopRequired: false,
};

const schemaFields = {
  version: { type: Number, default: 1 },
  enabledAt: { type: Date },   // server-managed: when proctoring was last switched on (older attempts keep their rules)
  switchAction: { type: String, enum: SWITCH_ACTIONS, default: 'WARN_AND_REQUIRE_FULLSCREEN' },
  cameraFailureAction: { type: String, enum: CAMERA_FAILURE_ACTIONS, default: 'BLOCK_UNTIL_RESTORED' },
};
Object.entries(BOOLEAN).forEach(([k, d]) => { schemaFields[k] = { type: Boolean, default: d }; });
Object.entries(NUMERIC).forEach(([k, [min, max, d]]) => { schemaFields[k] = { type: Number, min, max, default: d }; });

const proctoringPolicySchema = new mongoose.Schema(schemaFields, { _id: false });

const DEFAULT_POLICY = Object.freeze({
  version: 1,
  switchAction: 'WARN_AND_REQUIRE_FULLSCREEN',
  cameraFailureAction: 'BLOCK_UNTIL_RESTORED',
  ...BOOLEAN,
  ...Object.fromEntries(Object.entries(NUMERIC).map(([k, v]) => [k, v[2]])),
});

/** Full, normalised policy from whatever is stored on the exam (missing fields -> defaults). */
const resolvePolicy = (stored) => {
  const src = stored && typeof stored.toObject === 'function' ? stored.toObject() : (stored || {});
  const out = { ...DEFAULT_POLICY };
  for (const k of Object.keys(DEFAULT_POLICY)) if (src[k] !== undefined && src[k] !== null) out[k] = src[k];
  if (src.enabledAt) out.enabledAt = src.enabledAt;
  // strict mode = the strict response unless the examiner explicitly chose something else
  if (out.strictMode && (src.switchAction === undefined || src.switchAction === null)) out.switchAction = 'AUTO_SUBMIT_ON_CONFIRMED_SWITCH';
  if (!out.enabled) return { ...out, enabled: false };
  return out;
};

class PolicyValidationError extends Error {
  constructor(errors) { super(errors.join(' ')); this.errors = errors; }
}

/**
 * Validates a teacher/admin edit. Unknown keys are rejected (so a typo never silently does nothing).
 * Returns the cleaned partial update. Throws PolicyValidationError.
 */
const validatePolicyInput = (input) => {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new PolicyValidationError(['Proctoring settings must be an object.']);
  const errors = [];
  const clean = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === 'version' || k === 'enabledAt') continue; // server-managed
    if (k in BOOLEAN) {
      if (typeof v !== 'boolean') errors.push(`${k} must be true or false.`); else clean[k] = v;
    } else if (k in NUMERIC) {
      const [min, max] = NUMERIC[k];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) errors.push(`${k} must be a number between ${min} and ${max}.`);
      else clean[k] = k === 'phoneConfidence' ? Math.round(v * 100) / 100 : Math.round(v);
    } else if (k === 'switchAction') {
      if (!SWITCH_ACTIONS.includes(v)) errors.push(`switchAction must be one of ${SWITCH_ACTIONS.join(', ')}.`); else clean[k] = v;
    } else if (k === 'cameraFailureAction') {
      if (!CAMERA_FAILURE_ACTIONS.includes(v)) errors.push(`cameraFailureAction must be one of ${CAMERA_FAILURE_ACTIONS.join(', ')}.`); else clean[k] = v;
    } else {
      errors.push(`Unknown proctoring setting: ${k}.`);
    }
  }
  if (errors.length) throw new PolicyValidationError(errors);
  return clean;
};

/** Merge a validated edit into the stored policy; bumps `version` when anything actually changed. */
const applyPolicyEdit = (stored, edit) => {
  const current = resolvePolicy(stored);
  const next = { ...current, ...edit };
  if (edit.strictMode === true && edit.switchAction === undefined) next.switchAction = 'AUTO_SUBMIT_ON_CONFIRMED_SWITCH';
  const changed = Object.keys(edit).some((k) => current[k] !== next[k]) || (edit.strictMode === true && current.switchAction !== next.switchAction);
  next.version = (current.version || 1) + (changed ? 1 : 0);
  if (next.enabled && !current.enabled) next.enabledAt = new Date();
  return { policy: next, changed };
};

/** What a student may see before / during the exam (all of it is rules they must be told about). */
const publicPolicy = (stored) => {
  const p = resolvePolicy(stored);
  return p.enabled ? p : { enabled: false };
};

module.exports = {
  proctoringPolicySchema, DEFAULT_POLICY, NUMERIC, BOOLEAN, SWITCH_ACTIONS, CAMERA_FAILURE_ACTIONS,
  resolvePolicy, validatePolicyInput, applyPolicyEdit, publicPolicy, PolicyValidationError,
};
