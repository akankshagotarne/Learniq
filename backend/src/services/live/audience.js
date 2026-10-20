/**
 * Meeting audience ("Who can join this meeting?"): decides WHO may enter a live class. What a participant can SEE after joining is a
 * different setting (visibility mode in meetingConfig.js) and the host's "approve each student" switch is a third, separate check:
 *   1. audience eligibility  - may this account ask to enter at all?      (this file)
 *   2. admission approval    - does the eligible account wait for the host? (requireApproval)
 *
 * Pure functions only (plus one DB verifier that takes the User model as an argument) so every rule is unit-testable. The audience lives
 * inside LiveSession.meetingConfig.audience - no extra collection. A class WITHOUT a saved audience (created before this feature) is
 * "legacy": it keeps its historical behaviour (every signed-in, active student or teacher may ask to join) so nobody is locked out by a new field.
 */
const { STUDENT_STANDARDS, STANDARD_OTHERS, parseStudentStandard, standardLabel } = require('../../constants/standards');
const identity = require('../identity');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const STUDENT_MODES = ['none', 'all', 'standard', 'standards', 'students'];
const TEACHER_MODES = ['none', 'all', 'selected'];
const MAX_STUDENTS = 500;
const MAX_TEACHERS = 200;

const DEFAULT_AUDIENCE = Object.freeze({
  students: Object.freeze({ mode: 'all', standards: [], studentIds: [] }),
  teachers: Object.freeze({ mode: 'none', teacherIds: [] }),
});

const uniqueIds = (v, max) => (Array.isArray(v) ? [...new Set(v.map((x) => String(x)).filter((x) => OBJECT_ID.test(x)))].slice(0, max) : null);

/**
 * Validate an audience patch. Returns { audience, errors[] }. The patch replaces the stored audience part by part; anything invalid is
 * REJECTED with a message (never silently widened). Leftovers of another mode are dropped, and "All students" never needs standards.
 */
const sanitizeAudience = (input, base) => {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { audience: base || null, errors: ['The meeting audience is not valid.'] };
  const prev = base && typeof base === 'object' ? base : DEFAULT_AUDIENCE;
  const sIn = input.students && typeof input.students === 'object' ? input.students : (input.students === undefined ? {} : null);
  const tIn = input.teachers && typeof input.teachers === 'object' ? input.teachers : (input.teachers === undefined ? {} : null);
  if (sIn === null || tIn === null) return { audience: base || null, errors: ['The meeting audience is not valid.'] };

  const students = { mode: prev.students.mode, standards: [...(prev.students.standards || [])], studentIds: [...(prev.students.studentIds || [])] };
  if (sIn.mode !== undefined) {
    if (!STUDENT_MODES.includes(sIn.mode)) errors.push('Choose which students can join.'); else students.mode = sIn.mode;
  }
  if (sIn.standards !== undefined) {
    if (!Array.isArray(sIn.standards)) errors.push('The selected standards are not valid.');
    else {
      const parsed = sIn.standards.map(parseStudentStandard);
      if (parsed.some((x) => x === null)) errors.push('One of the selected standards is not a supported standard.');
      else students.standards = [...new Set(parsed)].sort((a, b) => a - b);
    }
  }
  if (sIn.studentIds !== undefined) {
    const list = uniqueIds(sIn.studentIds, MAX_STUDENTS);
    if (list === null) errors.push('The selected students are not valid.'); else students.studentIds = list;
  }
  const teachers = { mode: prev.teachers.mode, teacherIds: [...(prev.teachers.teacherIds || [])] };
  if (tIn.mode !== undefined) {
    if (!TEACHER_MODES.includes(tIn.mode)) errors.push('Choose which teachers can join.'); else teachers.mode = tIn.mode;
  }
  if (tIn.teacherIds !== undefined) {
    const list = uniqueIds(tIn.teacherIds, MAX_TEACHERS);
    if (list === null) errors.push('The selected teachers are not valid.'); else teachers.teacherIds = list;
  }
  if (errors.length) return { audience: base || null, errors };

  // consistency between the mode and its selection
  if (students.mode === 'standard' && students.standards.length !== 1) errors.push('Select exactly one standard.');
  if (students.mode === 'standards' && students.standards.length < 1) errors.push('Select at least one standard.');
  if (students.mode === 'students' && students.studentIds.length < 1) errors.push('Select at least one student.');
  if (teachers.mode === 'selected' && teachers.teacherIds.length < 1) errors.push('Select at least one teacher.');
  if (students.mode === 'none' && teachers.mode === 'none') errors.push('Choose at least one group that can join this meeting.');
  if (errors.length) return { audience: base || null, errors };

  // keep only what the chosen mode uses (so an old selection can never widen or narrow access invisibly)
  if (students.mode !== 'standard' && students.mode !== 'standards') students.standards = [];
  if (students.mode !== 'students') students.studentIds = [];
  if (teachers.mode !== 'selected') teachers.teacherIds = [];
  const audience = { students, teachers };
  ['createdBy', 'createdAt', 'updatedBy', 'updatedAt'].forEach((k) => { if (prev[k]) audience[k] = prev[k]; });
  return { audience, errors: [] };
};

/** The same shape with only well-formed values, or null for a legacy / malformed stored value (-> legacy behaviour). */
const normalizeAudience = (stored) => {
  if (!stored || typeof stored !== 'object') return null;
  const r = sanitizeAudience({ students: stored.students || {}, teachers: stored.teachers || {} }, DEFAULT_AUDIENCE);
  if (r.errors.length) return null;
  const a = r.audience;
  ['createdBy', 'createdAt', 'updatedBy', 'updatedAt'].forEach((k) => { if (stored[k]) a[k] = stored[k]; });
  return a;
};

const isLegacy = (cfg) => !cfg || !cfg.audience;

/** Is this person a currently usable account of the given kind? (trusted record fields, never client claims) */
const teacherUsable = (u) => !!(u && u.role === 'teacher' && u.isActive !== false && u.isApproved === true && identity.approvalStatusOf(u) === 'APPROVED');

/**
 * May this account ask to enter the class? `user` = { id | _id, role, currentStandard | standard, isActive, isApproved, approvalStatus }
 * taken from the database. Returns { ok, code }. The class owner is always eligible (they are the host, not an audience member);
 * administrators never join as participants (they use the moderation console), so they are not "eligible" here.
 */
const check = (cfg, user, { ownerId } = {}) => {
  if (!user) return { ok: false, code: 'NOT_SIGNED_IN' };
  const uid = String(user.id || user._id || '');
  if (user.role === 'admin') return { ok: false, code: 'ADMIN' };
  if (ownerId && uid === String(ownerId)) return { ok: true, code: 'HOST' };
  if (user.role !== 'student' && user.role !== 'teacher') return { ok: false, code: 'ROLE' };
  if (user.isActive === false) return { ok: false, code: 'INACTIVE' };
  if (user.role === 'teacher' && !teacherUsable(user)) return { ok: false, code: 'TEACHER_NOT_APPROVED' };
  if (isLegacy(cfg)) return { ok: true, code: 'LEGACY' };
  const a = cfg.audience;
  if (user.role === 'student') {
    const s = a.students;
    const std = user.currentStandard !== undefined ? user.currentStandard : user.standard;
    if (s.mode === 'all') return { ok: true, code: 'ALL_STUDENTS' };
    if (s.mode === 'standard' || s.mode === 'standards') return Number.isInteger(std) && s.standards.includes(std) ? { ok: true, code: 'STANDARD' } : { ok: false, code: 'NOT_IN_AUDIENCE' };
    if (s.mode === 'students') return s.studentIds.includes(uid) ? { ok: true, code: 'SELECTED_STUDENT' } : { ok: false, code: 'NOT_IN_AUDIENCE' };
    return { ok: false, code: 'NOT_IN_AUDIENCE' };
  }
  const t = a.teachers;
  if (t.mode === 'all') return { ok: true, code: 'ALL_TEACHERS' };
  if (t.mode === 'selected' && t.teacherIds.includes(uid)) return { ok: true, code: 'SELECTED_TEACHER' };
  return { ok: false, code: 'NOT_IN_AUDIENCE' };
};

const DENIED_MESSAGE = 'This class is not open to your account.';

/** May this viewer even SEE the class in a list / by its code? Owners and admins always; anonymous visitors only for classes open to every student. */
const mayView = (cfg, viewer, ownerId) => {
  if (viewer && viewer.role === 'admin') return true;
  if (!viewer) return isLegacy(cfg) || cfg.audience.students.mode === 'all';
  return check(cfg, viewer, { ownerId }).ok;
};

const joinList = (nums) => (nums.length <= 1 ? nums.join('') : `${nums.slice(0, -1).join(', ')} and ${nums[nums.length - 1]}`);
const describeStandards = (stds) => {
  const nums = stds.filter((n) => n !== STANDARD_OTHERS);
  const parts = [];
  if (nums.length) parts.push(`${nums.length === 1 ? 'Standard' : 'Standards'} ${joinList(nums)}`);
  if (stds.includes(STANDARD_OTHERS)) parts.push('Others');
  return parts.join(' and ');
};
/** One-line human description (the "Meeting access summary") */
const summarize = (cfg) => {
  if (isLegacy(cfg)) return { students: 'All signed-in students', teachers: 'All approved teachers', access: 'Authenticated eligible accounts only (older class)' };
  const { students: s, teachers: t } = cfg.audience;
  const students = s.mode === 'none' ? 'No students'
    : s.mode === 'all' ? 'All students - all standards'
      : s.mode === 'students' ? `${s.studentIds.length} selected student${s.studentIds.length === 1 ? '' : 's'}`
        : describeStandards(s.standards);
  const teachers = t.mode === 'none' ? 'No teachers' : t.mode === 'all' ? 'All eligible teachers' : `${t.teacherIds.length} selected teacher${t.teacherIds.length === 1 ? '' : 's'}`;
  return { students, teachers, access: 'Authenticated eligible accounts only' };
};

/** What non-owners may see of the audience: the kind, never the names / IDs. */
const publicAudience = (cfg) => {
  if (isLegacy(cfg)) return null;
  const { students: s, teachers: t } = cfg.audience;
  return { students: { mode: s.mode, standards: s.standards }, teachers: { mode: t.mode } };
};

/**
 * Check the selected people against the database: every selected student must be an existing, active student; every selected teacher an
 * existing, active, APPROVED teacher. `User` is the model (injected so tests can use an in-memory one). Returns { ok, code, message }.
 */
const verifyPeople = async (User, audience, { ownerId } = {}) => {
  if (!audience) return { ok: true };
  const sIds = audience.students.mode === 'students' ? audience.students.studentIds : [];
  const tIds = audience.teachers.mode === 'selected' ? audience.teachers.teacherIds : [];
  if (sIds.length) {
    const found = await User.find({ _id: { $in: sIds }, role: 'student', isActive: { $ne: false } }).select('_id').lean();
    if (found.length !== sIds.length) return { ok: false, code: 'INVALID_AUDIENCE', message: 'Some selected students are no longer available. Remove them and try again.' };
  }
  if (tIds.length) {
    if (ownerId && tIds.includes(String(ownerId))) return { ok: false, code: 'INVALID_AUDIENCE', message: 'You are the host of this class, so you do not need to select yourself.' };
    const found = await User.find({ _id: { $in: tIds }, role: 'teacher', isActive: { $ne: false }, isApproved: true }).select('_id approvalStatus isApproved').lean();
    const good = found.filter((u) => identity.approvalStatusOf(u) === 'APPROVED');
    if (good.length !== tIds.length) return { ok: false, code: 'INVALID_AUDIENCE', message: 'Some selected teachers are not eligible (not approved or not active). Remove them and try again.' };
  }
  return { ok: true };
};

module.exports = {
  STUDENT_MODES, TEACHER_MODES, DEFAULT_AUDIENCE, MAX_STUDENTS, MAX_TEACHERS, DENIED_MESSAGE,
  sanitizeAudience, normalizeAudience, isLegacy, check, mayView, summarize, publicAudience, verifyPeople, teacherUsable,
  STUDENT_STANDARDS, standardLabel,
};
