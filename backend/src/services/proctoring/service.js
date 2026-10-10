/**
 * Proctoring engine (server side). The browser runs the camera models and REPORTS confirmed episodes; this service is
 * the authority for everything that has consequences:
 *   - who may report for which attempt (own, running attempt only)
 *   - warning counters (stored here - a page refresh cannot reset them), deduplication (clientEventId + cooldown)
 *   - thresholds from the policy snapshot frozen at session start
 *   - automatic submission, always through the exam's normal finalisation (atomic, idempotent)
 *   - teacher / admin review with an append-only audit trail
 * Limitation (documented): events come from an unmanaged browser, so a modified client can stay silent. The server
 * therefore also enforces the deadline, requires a session before answers count, and records heartbeat gaps.
 */
const mongoose = require('mongoose');
const { ProctoringSession, ProctoringEvent, REVIEW_OUTCOMES } = require('../../models/Proctoring');
const { resolvePolicy } = require('./policy');
const { adapterFor, ProctoringError } = require('./adapters');

const MAX_EVENTS_PER_REQUEST = 25;
const HEARTBEAT_GAP_MS = 60 * 1000;

/** Event types a browser may report, and which counter (if any) each one feeds. */
const CLIENT_EVENTS = {
  FACE_MISSING: { counter: 'faceAbsence', severity: 'violation', enabledBy: 'faceMonitoring' },
  MULTIPLE_FACES: { counter: 'multiFace', severity: 'violation', enabledBy: 'multiFaceMonitoring' },
  MOBILE_PHONE_DETECTED: { counter: 'phone', severity: 'violation', enabledBy: 'phoneDetection' },
  FULLSCREEN_EXIT: { counter: 'fullscreenExit', severity: 'violation', enabledBy: 'fullscreenRequired' },
  FULLSCREEN_NOT_RESTORED: { counter: null, severity: 'critical', enabledBy: 'fullscreenRequired' },
  TAB_SWITCH: { counter: 'tabSwitch', severity: 'violation' },
  WINDOW_BLUR: { counter: 'windowBlur', severity: 'info' },         // supplementary signal only - never auto-submits
  COPY_PASTE: { counter: 'copyPaste', severity: 'warning' },
  CAMERA_DISCONNECTED: { counter: 'camera', severity: 'warning', enabledBy: 'cameraRequired' },
  CAMERA_UNAVAILABLE: { counter: 'camera', severity: 'warning', enabledBy: 'cameraRequired' },
  VIDEO_FEED_STALLED: { counter: 'camera', severity: 'warning', enabledBy: 'cameraRequired' },
  CAMERA_NOT_RESTORED: { counter: null, severity: 'critical', enabledBy: 'cameraRequired' },
  CAMERA_RESTORED: { counter: null, severity: 'info' },
};

const VIOLATION_COUNTERS = ['faceAbsence', 'multiFace', 'phone', 'fullscreenExit', 'tabSwitch'];

const limitsOf = (policy) => ({
  faceAbsence: policy.maxFaceAbsenceWarnings,
  multiFace: policy.maxMultiFaceWarnings,
  phone: policy.maxPhoneWarnings,
});

/** NOT_FLAGGED -> MONITORING_EVENTS (minor / technical only) -> FLAGGED_FOR_REVIEW; AUTO_SUBMITTED and REVIEWED win. */
const deriveStatus = (s) => {
  if (s.review && s.review.reviewedAt) return 'REVIEWED';
  if (s.status === 'COMPLETED' && s.terminationReason && !['MANUAL_SUBMISSION', 'EXAM_TIMEOUT'].includes(s.terminationReason)) return 'AUTO_SUBMITTED';
  const c = s.counts || {};
  if (VIOLATION_COUNTERS.some((k) => (c[k] || 0) > 0)) return 'FLAGGED_FOR_REVIEW';
  if (['windowBlur', 'camera', 'network', 'copyPaste'].some((k) => (c[k] || 0) > 0)) return 'MONITORING_EVENTS';
  return 'NOT_FLAGGED';
};

/** Which rule (if any) this counted event just broke. */
const terminationFor = (type, session, newCount) => {
  const p = session.policy;
  if (type === 'FACE_MISSING' && newCount >= p.maxFaceAbsenceWarnings) return 'FACE_ABSENCE_LIMIT';
  if (type === 'MULTIPLE_FACES' && newCount >= p.maxMultiFaceWarnings) return 'MULTIPLE_FACES_LIMIT';
  if (type === 'MOBILE_PHONE_DETECTED' && newCount > p.maxPhoneWarnings) return 'MOBILE_PHONE_REPEATED';
  if (type === 'TAB_SWITCH' && p.switchAction === 'AUTO_SUBMIT_ON_CONFIRMED_SWITCH') return 'STRICT_POLICY_VIOLATION';
  if (type === 'FULLSCREEN_NOT_RESTORED' && p.switchAction === 'AUTO_SUBMIT_ON_CONFIRMED_SWITCH') return 'STRICT_POLICY_VIOLATION';
  if (type === 'CAMERA_NOT_RESTORED' && p.cameraFailureAction === 'AUTO_SUBMIT_AFTER_GRACE') return 'CAMERA_FAILURE';
  return null;
};

const TERMINATION_TEXT = {
  FACE_ABSENCE_LIMIT: 'Maximum face-absence warnings reached.',
  MULTIPLE_FACES_LIMIT: 'Multiple faces repeatedly detected.',
  MOBILE_PHONE_REPEATED: 'Mobile phone repeatedly detected.',
  STRICT_POLICY_VIOLATION: 'Strict examination policy violation.',
  CAMERA_FAILURE: 'The camera could not be restored.',
  EXAM_TIMEOUT: 'The time limit was reached.',
  MANUAL_SUBMISSION: 'Submitted by the student.',
};

/** What the student's browser gets back (never review notes or other students' data). */
const studentState = (s) => ({
  sessionId: String(s._id),
  status: s.status,
  proctoringStatus: s.proctoringStatus,
  counts: { ...(s.counts && s.counts.toObject ? s.counts.toObject() : s.counts) },
  limits: limitsOf(s.policy),
  policy: s.policy,
  policyVersion: s.policyVersion,
  terminated: s.status === 'COMPLETED',
  terminationReason: s.terminationReason || null,
  terminationText: s.terminationReason ? TERMINATION_TEXT[s.terminationReason] : null,
  autoSubmitted: deriveStatus(s) === 'AUTO_SUBMITTED' || (s.status === 'COMPLETED' && !!s.terminationReason && !['MANUAL_SUBMISSION', 'EXAM_TIMEOUT'].includes(s.terminationReason)),
  terminatedAt: s.terminatedAt || null,
});

const serverEvent = (s, type, extra = {}) => ProctoringEvent.create({
  session: s._id, examKind: s.examKind, exam: s.exam, attempt: s.attempt, student: s.student,
  type, source: 'server', occurredAt: new Date(), severity: extra.severity || 'info', metadata: extra.metadata || {},
  counted: !!extra.counted, warningNumber: extra.warningNumber,
});

const isMobileRequest = (headers = {}, precheck = {}) => {
  if (precheck.mobileDevice === true) return true;
  if (headers['sec-ch-ua-mobile'] === '?1') return true;
  return /Mobi|Android|iPhone|iPad|iPod/i.test(String(headers['user-agent'] || ''));
};

// ─────────────────────────────────────────────────────────────
// Student: eligibility, session start, events, heartbeat
// ─────────────────────────────────────────────────────────────
const eligibility = async (kind, user, examId) => {
  const a = adapterFor(kind);
  const r = await a.eligibility(user, examId);
  const policy = r.exam ? resolvePolicy(a.policyOf(r.exam)) : null;
  return {
    eligible: !!r.eligible, code: r.code || null, message: r.message || null, resume: !!r.resume,
    proctoring: policy && policy.enabled ? policy : { enabled: false },
  };
};

const startSession = async ({ kind, user, examId, attemptId, consent, precheck = {}, headers = {} }) => {
  const a = adapterFor(kind);
  const { exam, attempt } = await a.loadOwnAttempt(user, examId, attemptId);
  if (await a.expireIfNeeded(attempt, exam)) throw new ProctoringError(409, 'This attempt has already been submitted.', 'ALREADY_COMPLETED');
  const policy = resolvePolicy(a.policyOf(exam));

  const existing = await ProctoringSession.findOne({ examKind: kind, attempt: attempt._id });
  if (existing) {
    if (existing.status === 'COMPLETED') return { state: studentState(existing), resumed: true };
    await serverEvent(existing, 'SESSION_RESUMED', { metadata: { faceCount: Number(precheck.faceCount) || 0 } });
    await ProctoringSession.updateOne({ _id: existing._id }, { $set: { lastHeartbeatAt: new Date() } });
    return { state: studentState(existing), resumed: true };
  }

  if (!policy.enabled) throw new ProctoringError(400, 'Proctoring is not enabled for this exam.', 'PROCTORING_NOT_ENABLED');
  if (consent !== true) throw new ProctoringError(400, 'Please read and accept the examination monitoring rules first.', 'CONSENT_REQUIRED');
  const mobile = isMobileRequest(headers, precheck);
  if (policy.desktopRequired && mobile) {
    throw new ProctoringError(403, 'This exam must be taken on a desktop or laptop computer with a webcam.', 'DESKTOP_REQUIRED');
  }
  if (policy.cameraRequired && !(Number(precheck.faceCount) === 1)) {
    throw new ProctoringError(400, 'The camera check must show exactly one face before the exam can start.', 'PRECHECK_REQUIRED');
  }
  if (policy.fullscreenRequired && precheck.fullscreen !== true) {
    throw new ProctoringError(400, 'The exam must be started in fullscreen mode.', 'FULLSCREEN_REQUIRED');
  }

  const now = new Date();
  let session;
  try {
    session = await ProctoringSession.create({
      examKind: kind, exam: exam._id, attempt: attempt._id, student: user._id,
      policy, policyVersion: policy.version || 1,
      consentAt: now, lastHeartbeatAt: now,
      precheck: {
        passedAt: now, faceCount: Number(precheck.faceCount) || 0, fullscreen: precheck.fullscreen === true,
        mobileDevice: mobile, detector: typeof precheck.detector === 'string' ? precheck.detector.slice(0, 80) : undefined,
      },
    });
  } catch (err) {
    if (err.code !== 11000) throw err;
    session = await ProctoringSession.findOne({ examKind: kind, attempt: attempt._id }); // two tabs / double click
    return { state: studentState(session), resumed: true };
  }
  await serverEvent(session, 'SESSION_STARTED', { metadata: { policyVersion: session.policyVersion } });
  return { state: studentState(session), resumed: false };
};

const loadOwnSession = async (user, sessionId) => {
  if (!mongoose.isValidObjectId(sessionId)) throw new ProctoringError(404, 'Proctoring session not found.', 'NO_SESSION');
  const s = await ProctoringSession.findOne({ _id: sessionId, student: user._id });
  if (!s) throw new ProctoringError(404, 'Proctoring session not found.', 'NO_SESSION');
  return s;
};

const META_NUMBERS = ['durationMs', 'faceCount', 'hiddenMs', 'graceMs'];
const META_STRINGS = ['label', 'reason', 'detail'];
const cleanMetadata = (m) => {
  const out = {};
  if (!m || typeof m !== 'object' || Array.isArray(m)) return out;
  META_NUMBERS.forEach((k) => { if (typeof m[k] === 'number' && Number.isFinite(m[k])) out[k] = Math.max(0, Math.min(Math.round(m[k]), 24 * 3600 * 1000)); });
  META_STRINGS.forEach((k) => { if (typeof m[k] === 'string') out[k] = m[k].slice(0, 64); });
  if (typeof m.restored === 'boolean') out.restored = m.restored;
  return out;
};

const validateEvent = (e, session, now) => {
  if (!e || typeof e !== 'object') throw new ProctoringError(400, 'Invalid event.', 'INVALID_EVENT');
  const def = CLIENT_EVENTS[e.type];
  if (!def) throw new ProctoringError(400, `Unknown event type: ${String(e.type).slice(0, 40)}.`, 'INVALID_EVENT_TYPE');
  if (typeof e.clientEventId !== 'string' || !/^[A-Za-z0-9_-]{6,64}$/.test(e.clientEventId)) {
    throw new ProctoringError(400, 'Each event needs a clientEventId (6-64 letters, digits, - or _).', 'INVALID_EVENT');
  }
  let occurredAt = e.occurredAt ? new Date(e.occurredAt) : now;
  if (Number.isNaN(occurredAt.getTime())) occurredAt = now;
  const floor = session.createdAt || now;
  if (occurredAt > now) occurredAt = now;
  if (occurredAt < floor) occurredAt = floor;
  let confidence;
  if (e.confidence !== undefined && e.confidence !== null) {
    if (typeof e.confidence !== 'number' || e.confidence < 0 || e.confidence > 1) throw new ProctoringError(400, 'confidence must be between 0 and 1.', 'INVALID_EVENT');
    confidence = Math.round(e.confidence * 1000) / 1000;
  }
  return { def, type: e.type, clientEventId: e.clientEventId, occurredAt, confidence, metadata: cleanMetadata(e.metadata) };
};

/** Close the session and finish the attempt through the exam's own pipeline. Safe to call concurrently. */
const terminate = async (session, reason, kindAdapter) => {
  const done = await ProctoringSession.findOneAndUpdate(
    { _id: session._id, status: 'ACTIVE' },
    { $set: { status: 'COMPLETED', terminationReason: reason, terminatedAt: new Date(), proctoringStatus: 'AUTO_SUBMITTED' } },
    { new: true },
  );
  if (!done) return ProctoringSession.findById(session._id); // another request already ended it - first rule wins
  await serverEvent(done, 'AUTO_SUBMISSION', { severity: 'critical', metadata: { reason } });
  await kindAdapter.finalize(done.attempt, reason);
  return done;
};

/**
 * Store a batch of confirmed episodes from the browser. Returns the authoritative state (+ whether the exam ended).
 * `answersSnapshot` (optional) is the student's latest answers, stored before an automatic submission.
 */
const recordEvents = async ({ user, sessionId, events, answersSnapshot }) => {
  let session = await loadOwnSession(user, sessionId);
  if (session.status === 'COMPLETED') return { state: studentState(session), accepted: 0 };
  if (!Array.isArray(events) || events.length === 0) throw new ProctoringError(400, 'No events.', 'INVALID_EVENT');
  if (events.length > MAX_EVENTS_PER_REQUEST) throw new ProctoringError(400, `At most ${MAX_EVENTS_PER_REQUEST} events per request.`, 'INVALID_EVENT');

  const a = adapterFor(session.examKind);
  const { exam, attempt } = await a.loadAttemptById(session.attempt);
  if (!attempt || !exam) throw new ProctoringError(404, 'Attempt not found.', 'NO_ATTEMPT');
  const now = new Date();
  if (await a.expireIfNeeded(attempt, exam, now) || !a.isActive(attempt)) {
    session = await ProctoringSession.findById(session._id);
    return { state: studentState(session), accepted: 0 };
  }

  const parsed = events.map((e) => validateEvent(e, session, now)); // all-or-nothing validation
  let accepted = 0; let termination = null;

  for (const ev of parsed) {
    if (termination) break;
    const enabled = !ev.def.enabledBy || session.policy[ev.def.enabledBy] !== false;
    let doc;
    try {
      doc = await ProctoringEvent.create({
        session: session._id, examKind: session.examKind, exam: session.exam, attempt: session.attempt, student: session.student,
        type: ev.type, severity: ev.def.severity, clientEventId: ev.clientEventId, occurredAt: ev.occurredAt,
        confidence: ev.confidence, metadata: enabled ? ev.metadata : { ...ev.metadata, ignored: 'rule disabled for this exam' },
      });
    } catch (err) {
      if (err.code === 11000) continue; // retry of an event we already have
      throw err;
    }
    accepted += 1;
    if (!enabled) continue;

    // a phone must also clear the configured confidence on the server - a low-confidence report is logged, not counted
    if (ev.type === 'MOBILE_PHONE_DETECTED' && !(typeof ev.confidence === 'number' && ev.confidence >= session.policy.phoneConfidence)) {
      await ProctoringEvent.updateOne({ _id: doc._id }, { $set: { severity: 'info', 'metadata.reason': 'below confidence threshold' } });
      continue;
    }

    if (ev.def.counter) {
      const field = `counts.${ev.def.counter}`;
      const cooldownKey = `lastCounted.${ev.def.counter}`;
      const since = new Date(now.getTime() - (session.policy.warningCooldownMs || 5000));
      const updated = await ProctoringSession.findOneAndUpdate(
        { _id: session._id, status: 'ACTIVE', $or: [{ [cooldownKey]: { $exists: false } }, { [cooldownKey]: { $lte: since } }] },
        { $inc: { [field]: 1 }, $set: { [cooldownKey]: now } },
        { new: true },
      );
      if (!updated) {
        const fresh = await ProctoringSession.findById(session._id);
        if (fresh.status === 'COMPLETED') { session = fresh; break; }
        await ProctoringEvent.updateOne({ _id: doc._id }, { $set: { 'metadata.reason': 'duplicate within cooldown' } });
        continue;
      }
      session = updated;
      const n = session.counts[ev.def.counter];
      const max = limitsOf(session.policy)[ev.def.counter];
      await ProctoringEvent.updateOne({ _id: doc._id }, { $set: { counted: true, warningNumber: n, maxWarnings: max } });
      const status = deriveStatus(session);
      if (status !== session.proctoringStatus) {
        session = await ProctoringSession.findOneAndUpdate({ _id: session._id, status: 'ACTIVE' }, { $set: { proctoringStatus: status } }, { new: true }) || session;
      }
      termination = terminationFor(ev.type, session, n);
    } else {
      termination = terminationFor(ev.type, session, 0);
    }
  }

  if (termination) {
    if (answersSnapshot !== undefined) {
      try { await a.applySnapshot(attempt, exam, answersSnapshot, now); } catch (e) { /* invalid snapshot: keep the saved answers */ }
    }
    session = await terminate(session, termination, a);
  }
  return { state: studentState(session), accepted };
};

const heartbeat = async ({ user, sessionId }) => {
  let session = await loadOwnSession(user, sessionId);
  if (session.status === 'COMPLETED') return { state: studentState(session) };
  const a = adapterFor(session.examKind);
  const { exam, attempt } = await a.loadAttemptById(session.attempt);
  const now = new Date();
  if (!attempt || await a.expireIfNeeded(attempt, exam, now)) {
    session = await ProctoringSession.findById(session._id);
    return { state: studentState(session) };
  }
  const gap = session.lastHeartbeatAt ? now.getTime() - new Date(session.lastHeartbeatAt).getTime() : 0;
  const update = { $set: { lastHeartbeatAt: now } };
  if (gap > HEARTBEAT_GAP_MS) update.$inc = { 'counts.network': 1 };
  session = await ProctoringSession.findOneAndUpdate({ _id: session._id, status: 'ACTIVE' }, update, { new: true }) || await ProctoringSession.findById(session._id);
  if (gap > HEARTBEAT_GAP_MS) {
    // recorded as a technical event - a lost connection is NOT treated as misconduct
    await serverEvent(session, 'NETWORK_INTERRUPTION', { severity: 'info', counted: true, metadata: { durationMs: gap } });
    const status = deriveStatus(session);
    if (status !== session.proctoringStatus) await ProctoringSession.updateOne({ _id: session._id }, { $set: { proctoringStatus: status } });
  }
  const deadline = a.deadlineOf(attempt, exam);
  return { state: studentState(session), remainingSeconds: deadline ? Math.max(0, Math.ceil((new Date(deadline).getTime() - now.getTime()) / 1000)) : null };
};

/** Called by the exam pipelines after a manual submit / timeout so the session is closed with the right reason. */
const closeForAttempt = async (kind, attemptId, reason) => {
  if (!reason) return null;
  const s = await ProctoringSession.findOneAndUpdate(
    { examKind: kind, attempt: attemptId, status: 'ACTIVE' },
    { $set: { status: 'COMPLETED', terminationReason: reason, terminatedAt: new Date() } },
    { new: true },
  );
  if (!s) return null;
  await serverEvent(s, reason === 'MANUAL_SUBMISSION' ? 'MANUAL_SUBMISSION' : 'EXAM_TIMEOUT');
  const status = deriveStatus(s);
  if (status !== s.proctoringStatus) await ProctoringSession.updateOne({ _id: s._id }, { $set: { proctoringStatus: status } });
  return s;
};

/** Answers only count for a proctored exam once the student has passed the checks and has an open session. */
const requireActiveSession = async (kind, exam, attempt) => {
  const policy = resolvePolicy(exam.proctoring);
  if (!policy.enabled) return null;
  // an attempt that was already running when proctoring was switched on keeps the rules it started with
  if (policy.enabledAt && attempt.startedAt && new Date(attempt.startedAt) < new Date(policy.enabledAt)) return null;
  const s = await ProctoringSession.findOne({ examKind: kind, attempt: attempt._id }).select('status');
  if (!s) throw new ProctoringError(409, 'Complete the camera and fullscreen checks before answering this exam.', 'PROCTORING_SESSION_REQUIRED');
  return s;
};

// ─────────────────────────────────────────────────────────────
// Teacher / admin: summaries, timeline, review
// ─────────────────────────────────────────────────────────────
const summaryOf = (s) => ({
  sessionId: String(s._id),
  proctoringStatus: deriveStatus(s),
  counts: { ...(s.counts && s.counts.toObject ? s.counts.toObject() : s.counts) },
  limits: limitsOf(s.policy),
  terminationReason: s.terminationReason || null,
  terminationText: s.terminationReason ? TERMINATION_TEXT[s.terminationReason] : null,
  terminatedAt: s.terminatedAt || null,
  reviewRequired: ['FLAGGED_FOR_REVIEW', 'AUTO_SUBMITTED'].includes(deriveStatus(s)),
  review: s.review && s.review.reviewedAt ? { outcome: s.review.outcome, reviewedAt: s.review.reviewedAt } : null,
});

const summariesForAttempts = async (kind, attemptIds) => {
  if (!attemptIds.length) return new Map();
  const rows = await ProctoringSession.find({ examKind: kind, attempt: { $in: attemptIds } });
  return new Map(rows.map((s) => [String(s.attempt), summaryOf(s)]));
};

const assertReviewer = async (user, session) => {
  if (user.role === 'admin') return;
  if (user.role === 'teacher') {
    const { ids } = await adapterFor(session.examKind).reviewerIds(session.exam);
    if (ids.includes(String(user._id))) return;
  }
  throw new ProctoringError(404, 'Proctoring record not found.', 'NO_SESSION'); // 404: do not reveal that it exists
};

const loadForReview = async (user, sessionId) => {
  if (!mongoose.isValidObjectId(sessionId)) throw new ProctoringError(404, 'Proctoring record not found.', 'NO_SESSION');
  const s = await ProctoringSession.findById(sessionId);
  if (!s) throw new ProctoringError(404, 'Proctoring record not found.', 'NO_SESSION');
  await assertReviewer(user, s);
  return s;
};

const reviewDetail = async (user, sessionId) => {
  const s = await loadForReview(user, sessionId);
  const User = require('../../models/User');
  const [events, student, reviewers] = await Promise.all([
    ProctoringEvent.find({ session: s._id }).sort({ occurredAt: 1, createdAt: 1 }).limit(1000)
      .select('type severity source counted warningNumber maxWarnings confidence occurredAt metadata'),
    User.findById(s.student).select('name email'),
    User.find({ _id: { $in: (s.reviewHistory || []).map((r) => r.by) } }).select('name'),
  ]);
  const names = new Map(reviewers.map((u) => [String(u._id), u.name]));
  const { title } = await adapterFor(s.examKind).reviewerIds(s.exam);
  return {
    ...summaryOf(s),
    examKind: s.examKind, examTitle: title,
    student: student ? { _id: student._id, name: student.name, email: student.email } : null,
    policy: s.policy, policyVersion: s.policyVersion,
    startedAt: s.createdAt, consentAt: s.consentAt, precheck: s.precheck, status: s.status,
    events: events.map((e) => ({
      type: e.type, severity: e.severity, source: e.source, counted: e.counted, warningNumber: e.warningNumber,
      maxWarnings: e.maxWarnings, confidence: e.confidence, occurredAt: e.occurredAt, metadata: e.metadata,
    })),
    reviewHistory: (s.reviewHistory || []).map((r) => ({ by: names.get(String(r.by)) || 'Unknown', byRole: r.byRole, at: r.at, outcome: r.outcome, note: r.note })),
  };
};

const submitReview = async (user, sessionId, body = {}) => {
  const s = await loadForReview(user, sessionId);
  const { outcome } = body;
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (!REVIEW_OUTCOMES.includes(outcome)) throw new ProctoringError(400, `outcome must be one of ${REVIEW_OUTCOMES.join(', ')}.`, 'INVALID_REVIEW');
  if (note.length > 2000) throw new ProctoringError(400, 'The note can be at most 2000 characters.', 'INVALID_REVIEW');
  if (s.status !== 'COMPLETED') throw new ProctoringError(409, 'This attempt is still in progress. Review it after it has been submitted.', 'ATTEMPT_IN_PROGRESS');
  const at = new Date();
  const updated = await ProctoringSession.findByIdAndUpdate(
    s._id,
    {
      $set: { review: { outcome, note, reviewedBy: user._id, reviewedAt: at }, proctoringStatus: 'REVIEWED' },
      $push: { reviewHistory: { by: user._id, byRole: user.role, at, outcome, note } }, // append-only audit trail
    },
    { new: true },
  );
  return summaryOf(updated);
};

// the teacher-exam pipeline tells us when an attempt finished (manual submit / timeout)
require('../examAttempts').onFinalized(closeForAttempt);

module.exports = {
  CLIENT_EVENTS, TERMINATION_TEXT, deriveStatus, terminationFor, limitsOf,
  eligibility, startSession, recordEvents, heartbeat, closeForAttempt, requireActiveSession,
  summariesForAttempts, summaryOf, reviewDetail, submitReview, studentState,
};
