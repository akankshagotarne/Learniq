/**
 * Cleanup of OLD Olympiad exam-attempt and interview records (everything dated before 17 Oct 2026, 00:00 IST).
 *
 * This module only PLANS (read-only) and EXECUTES a plan that was reviewed. The command line wrapper is
 * scripts/cleanupOldOlympiadRecords.js. Nothing here runs by itself.
 *
 * WHAT IS DELETED (only when the record can be reliably tied to an old attempt / has its own old timestamp)
 *   OlympiadAttempt            answers, score, result, evaluation (all inside the attempt document)
 *   OlympiadAttemptHistory     earlier attempts kept after an admin reset (snapshot of an old attempt)
 *   ProctoringSession/Event    proctoring data of a deleted attempt
 *   TeacherInterview           interview of a deleted attempt (requests, join requests, assignment, status, audit, remarks)
 *   InterviewEvaluation        marks / ratings / remarks of a deleted interview
 *   InterviewSlot/Reminder     appointments dated wholly before the cutoff and the reminders of deleted slots
 *   AIInterview                AI interview sessions (questions, answers, transcript, score) whose own activity is before the cutoff
 *
 * WHAT IS NEVER TOUCHED
 *   users (students / teachers / admins), OlympiadPayment (and Razorpay data), Payment, Certificate (+ QR / verification data),
 *   OlympiadExam and OlympiadQuestion (configuration / question bank), InterviewSchedule and InterviewSetting (configuration),
 *   ExamAdminAudit (append-only audit log), AccessGrants, courses and everything else.
 *
 * SAFETY RULES
 *   - an old attempt that a Certificate points at is KEPT (deleting it would break the certificate PDF and QR verification)
 *   - an old attempt whose interview has activity on/after the cutoff is KEPT and reported for review
 *   - missing / unreadable timestamps are never guessed: the record is reported for manual review
 *   - deletes use exact `_id` lists from the reviewed plan, children before parents, and skip any document modified after the plan
 *   - the plan has a hash; execution requires the hash of the dry run the operator reviewed
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** 17 Oct 2026 00:00:00 IST == 16 Oct 2026 18:30:00 UTC. A record is OLD when its timestamp is STRICTLY EARLIER. */
const CUTOFF = new Date('2026-10-16T18:30:00.000Z');
const CUTOFF_LABEL = '17 Oct 2026 00:00:00 IST (2026-10-16T18:30:00.000Z)';
const CONFIRM_PHRASE = 'DELETE-OLD-OLYMPIAD-RECORDS';
const CHUNK = 500;

const when = (v) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
const sid = (v) => String(v && v._id ? v._id : v);
const isOld = (d) => d !== null && d.getTime() < CUTOFF.getTime();
const latest = (...vals) => { const d = vals.map(when).filter(Boolean); return d.length ? new Date(Math.max(...d.map((x) => x.getTime()))) : null; };
const chunk = (arr, n = CHUNK) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

/** Order matters for execution (children first). */
const DELETE_ORDER = ['ProctoringEvent', 'ProctoringSession', 'InterviewEvaluation', 'TeacherInterview', 'InterviewReminder', 'InterviewSlot', 'AIInterview', 'OlympiadAttemptHistory', 'OlympiadAttempt'];
const PROTECTED = ['User', 'OlympiadPayment', 'Certificate', 'OlympiadExam', 'OlympiadQuestion'];

const bucket = () => ({ examined: 0, delete: [], preserve: 0, review: [], protected: [] });

/** READ-ONLY. Computes exactly which records would be deleted. */
const buildPlan = async (M, { excludeEngineering = false, now = new Date() } = {}) => {
  const c = Object.fromEntries(DELETE_ORDER.map((n) => [n, bucket()]));
  const note = (name, kind, id, reason) => c[name][kind].push(reason ? { id: sid(id), reason } : sid(id));

  const [attempts, certs, exams, histories, sessions, interviews, evaluations, slots, reminders, aiInterviews] = await Promise.all([
    M.OlympiadAttempt.find({}).select('student exam status startedAt submittedAt payment'),
    M.Certificate.find({}).select('attempt student exam'),
    M.OlympiadExam.find({}).select('title standard examType startDate endDate'),
    M.OlympiadAttemptHistory.find({}).select('originalAttempt student exam startedAt submittedAt resetAt'),
    M.ProctoringSession.find({}).select('examKind exam attempt'),
    M.TeacherInterview.find({}).select('student exam attempt status requestedAt assignedAt joinRequestedAt approvedAt startedAt endedAt createdAt'),
    M.InterviewEvaluation.find({}).select('interview student exam attempt'),
    M.InterviewSlot.find({}).select('student exam startAt endAt'),
    M.InterviewReminder.find({}).select('slot startAt dueAt'),
    M.AIInterview.find({}).select('student exam status startedAt completedAt firstQuestionPresentedAt consumedAt createdAt'),
  ]);
  const examById = new Map(exams.map((e) => [sid(e._id), e]));
  const certAttempts = new Set(certs.map((x) => sid(x.attempt)));
  const certPairs = new Set(certs.map((x) => `${sid(x.student)}:${sid(x.exam)}`));
  const interviewsByAttempt = new Map();
  interviews.forEach((i) => { const k = sid(i.attempt); if (!interviewsByAttempt.has(k)) interviewsByAttempt.set(k, []); interviewsByAttempt.get(k).push(i); });
  const interviewActivity = (i) => latest(i.requestedAt, i.assignedAt, i.joinRequestedAt, i.approvedAt, i.startedAt, i.endedAt, i.createdAt);

  // ── attempts
  const delAttempts = new Set(); const byExam = new Map();
  c.OlympiadAttempt.examined = attempts.length;
  for (const a of attempts) {
    const id = sid(a._id);
    const exam = examById.get(sid(a.exam));
    if (excludeEngineering && exam && exam.examType === 'engineering') { c.OlympiadAttempt.preserve += 1; continue; }
    const t = a.status === 'COMPLETED' ? when(a.submittedAt) : when(a.startedAt); // the SUBMISSION time decides for submitted attempts
    if (!t) { note('OlympiadAttempt', 'review', id, a.status === 'COMPLETED' ? 'SUBMITTED_WITHOUT_SUBMISSION_TIME' : 'MISSING_START_TIME'); continue; }
    if (!isOld(t)) { c.OlympiadAttempt.preserve += 1; continue; }
    if (certAttempts.has(id) || certPairs.has(`${sid(a.student)}:${sid(a.exam)}`)) { note('OlympiadAttempt', 'protected', id, 'CERTIFICATE_REFERENCES_ATTEMPT'); continue; }
    const late = (interviewsByAttempt.get(id) || []).find((i) => { const l = interviewActivity(i); return l && !isOld(l); });
    if (late) { note('OlympiadAttempt', 'review', id, 'INTERVIEW_ACTIVITY_ON_OR_AFTER_CUTOFF'); continue; }
    c.OlympiadAttempt.delete.push(id); delAttempts.add(id);
    const k = sid(a.exam); byExam.set(k, (byExam.get(k) || 0) + 1);
  }

  // ── attempt history (earlier attempts kept after an admin reset)
  const delHistoryOriginals = new Set();
  c.OlympiadAttemptHistory.examined = histories.length;
  for (const h of histories) {
    const id = sid(h._id);
    const t = latest(h.submittedAt) || when(h.startedAt) || when(h.resetAt);
    const reset = when(h.resetAt);
    if (!t) { note('OlympiadAttemptHistory', 'review', id, 'MISSING_TIMESTAMP'); continue; }
    if (!isOld(t)) { c.OlympiadAttemptHistory.preserve += 1; continue; }
    if (certAttempts.has(sid(h.originalAttempt))) { note('OlympiadAttemptHistory', 'protected', id, 'CERTIFICATE_REFERENCES_ATTEMPT'); continue; }
    if (reset && !isOld(reset)) { note('OlympiadAttemptHistory', 'review', id, 'RESET_ON_OR_AFTER_CUTOFF'); continue; }
    c.OlympiadAttemptHistory.delete.push(id); delHistoryOriginals.add(sid(h.originalAttempt));
  }
  const isDeletedAttempt = (attemptId) => delAttempts.has(sid(attemptId)) || delHistoryOriginals.has(sid(attemptId));
  const knownAttempt = new Set([...attempts.map((a) => sid(a._id)), ...histories.map((h) => sid(h.originalAttempt))]);

  // ── proctoring (only data of a deleted attempt)
  const delSessions = new Set();
  c.ProctoringSession.examined = sessions.length;
  for (const s of sessions) {
    const id = sid(s._id);
    if (isDeletedAttempt(s.attempt)) { c.ProctoringSession.delete.push(id); delSessions.add(id); }
    else if (knownAttempt.has(sid(s.attempt))) c.ProctoringSession.preserve += 1;
    else note('ProctoringSession', 'review', id, 'NO_ATTEMPT_REFERENCE');
  }
  c.ProctoringEvent.examined = await M.ProctoringEvent.countDocuments({});
  for (const part of chunk([...delSessions])) {
    const events = await M.ProctoringEvent.find({ session: { $in: part } }).select('_id');
    events.forEach((e) => c.ProctoringEvent.delete.push(sid(e._id)));
  }
  c.ProctoringEvent.preserve = c.ProctoringEvent.examined - c.ProctoringEvent.delete.length;

  // ── teacher interviews (+ evaluations)
  const delInterviews = new Set();
  c.TeacherInterview.examined = interviews.length;
  for (const i of interviews) {
    const id = sid(i._id);
    if (isDeletedAttempt(i.attempt)) { c.TeacherInterview.delete.push(id); delInterviews.add(id); continue; }
    if (knownAttempt.has(sid(i.attempt))) { c.TeacherInterview.preserve += 1; continue; }
    // no attempt record behind it any more: fall back to the interview's OWN timestamps, same cutoff
    const own = interviewActivity(i);
    if (!own) note('TeacherInterview', 'review', id, 'NO_ATTEMPT_AND_NO_TIMESTAMP');
    else if (isOld(own)) { c.TeacherInterview.delete.push(id); delInterviews.add(id); }
    else c.TeacherInterview.preserve += 1;
  }
  const interviewIds = new Set(interviews.map((i) => sid(i._id)));
  c.InterviewEvaluation.examined = evaluations.length;
  for (const ev of evaluations) {
    const id = sid(ev._id);
    if (delInterviews.has(sid(ev.interview))) c.InterviewEvaluation.delete.push(id);
    else if (interviewIds.has(sid(ev.interview))) c.InterviewEvaluation.preserve += 1;
    else if (ev.attempt && isDeletedAttempt(ev.attempt)) c.InterviewEvaluation.delete.push(id);
    else note('InterviewEvaluation', 'review', id, 'NO_INTERVIEW_REFERENCE');
  }

  // ── appointments + reminders (dated by the appointment itself)
  const delSlots = new Set();
  c.InterviewSlot.examined = slots.length;
  for (const s of slots) {
    const id = sid(s._id); const start = when(s.startAt); const end = when(s.endAt);
    if (!start || !end) note('InterviewSlot', 'review', id, 'MISSING_TIMESTAMP');
    else if (isOld(end)) { c.InterviewSlot.delete.push(id); delSlots.add(id); }
    else if (isOld(start)) note('InterviewSlot', 'review', id, 'SLOT_SPANS_THE_CUTOFF');
    else c.InterviewSlot.preserve += 1;
  }
  c.InterviewReminder.examined = reminders.length;
  for (const r of reminders) {
    const id = sid(r._id);
    if (r.slot && delSlots.has(sid(r.slot))) c.InterviewReminder.delete.push(id);
    else if (!r.slot && isOld(when(r.startAt)) && isOld(when(r.dueAt))) c.InterviewReminder.delete.push(id);
    else c.InterviewReminder.preserve += 1; // a SENT reminder of a kept slot must stay: its dedupe key prevents a second message
  }

  // ── AI interviews (their own activity)
  c.AIInterview.examined = aiInterviews.length;
  for (const a of aiInterviews) {
    const id = sid(a._id);
    const t = latest(a.completedAt, a.startedAt, a.firstQuestionPresentedAt, a.consumedAt) || when(a.createdAt);
    if (!t) note('AIInterview', 'review', id, 'MISSING_TIMESTAMP');
    else if (isOld(t)) c.AIInterview.delete.push(id);
    else c.AIInterview.preserve += 1;
  }

  const [users, payments, certificates, examsTotal, questions, audits] = await Promise.all([
    M.User.countDocuments({}), M.OlympiadPayment.countDocuments({}), M.Certificate.countDocuments({}),
    M.OlympiadExam.countDocuments({}), M.OlympiadQuestion.countDocuments({}), M.ExamAdminAudit.countDocuments({}),
  ]);
  const paymentRefs = new Set(attempts.filter((a) => delAttempts.has(sid(a._id)) && a.payment).map((a) => sid(a.payment)));
  const hash = crypto.createHash('sha256').update(JSON.stringify({ cutoff: CUTOFF.toISOString(), excludeEngineering, del: DELETE_ORDER.map((n) => [n, [...c[n].delete].sort()]) })).digest('hex').slice(0, 24);
  return {
    generatedAt: now, cutoff: CUTOFF.toISOString(), cutoffLabel: CUTOFF_LABEL, excludeEngineering, hash,
    collections: c,
    protectedCounts: { User: users, OlympiadPayment: payments, Certificate: certificates, OlympiadExam: examsTotal, OlympiadQuestion: questions, ExamAdminAudit: audits },
    paymentsLinkedToDeletedAttempts: paymentRefs.size,
    attemptsByExam: [...byExam.entries()].map(([id, n]) => {
      const e = examById.get(id);
      return { exam: e ? e.title : '(unknown exam)', standard: e ? e.standard : null, examType: e ? e.examType || 'olympiad' : null, windowEnds: e ? when(e.endDate) : null, windowStillOpenOrUpcoming: e ? Boolean(when(e.endDate) && when(e.endDate) >= now) : null, attemptsToDelete: n };
    }),
  };
};

/** Compact, secret-free, PII-free summary of a plan (ids are not printed). */
const summarise = (plan) => ({
  cutoff: plan.cutoffLabel, planHash: plan.hash, excludeEngineering: plan.excludeEngineering,
  collections: Object.fromEntries(DELETE_ORDER.map((n) => {
    const b = plan.collections[n];
    return [n, { examined: b.examined, toDelete: b.delete.length, preserved: b.preserve, protectedSkipped: b.protected.length, manualReview: b.review.length }];
  })),
  reviewReasons: Object.fromEntries(DELETE_ORDER.map((n) => [n, plan.collections[n].review.concat(plan.collections[n].protected).reduce((m, r) => { m[r.reason] = (m[r.reason] || 0) + 1; return m; }, {})]).filter(([, v]) => Object.keys(v).length)),
  neverDeleted: plan.protectedCounts,
  paymentsLinkedToDeletedAttempts: plan.paymentsLinkedToDeletedAttempts,
  attemptsByExam: plan.attemptsByExam,
});

let EJSON = null; try { ({ EJSON } = require('bson')); } catch (e) { EJSON = null; }
const serialize = (doc) => (EJSON ? EJSON.stringify(doc, { relaxed: false }) : JSON.stringify(doc));

/**
 * Writes every document that is about to be deleted to NDJSON files (recoverable: re-insert the lines) and verifies them.
 * Files contain personal data: mode 0600, never commit them (see .gitignore: old-olympiad-archive-*).
 */
const writeArchive = async (M, plan, dir) => {
  const root = path.join(dir, `old-olympiad-archive-${plan.hash}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const manifest = { planHash: plan.hash, cutoff: plan.cutoff, createdAt: new Date().toISOString(), files: {} };
  for (const name of DELETE_ORDER) {
    const ids = plan.collections[name].delete;
    if (!ids.length) continue;
    const file = path.join(root, `${name}.ndjson`);
    const fd = fs.openSync(file, 'w', 0o600);
    let written = 0;
    for (const part of chunk(ids)) {
      const docs = await M[name].find({ _id: { $in: part } }).lean();
      for (const d of docs) { fs.writeSync(fd, `${serialize(d)}\n`); written += 1; }
    }
    fs.fsyncSync(fd); fs.closeSync(fd);
    if (written !== ids.length) throw new Error(`Archive of ${name} is incomplete (${written} of ${ids.length}). Nothing was deleted.`);
    const text = fs.readFileSync(file);
    const lines = text.toString('utf8').split('\n').filter(Boolean).length;
    if (lines !== ids.length) throw new Error(`Archive verification failed for ${name}. Nothing was deleted.`);
    manifest.files[name] = { documents: written, sha256: crypto.createHash('sha256').update(text).digest('hex') };
  }
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  return { root, manifest };
};

/** Deletes exactly the planned ids (children first). A document modified after the plan was made is skipped, never deleted. */
const executePlan = async (M, plan) => {
  const deleted = {}; const skipped = {};
  for (const name of DELETE_ORDER) {
    const ids = plan.collections[name].delete;
    deleted[name] = 0; skipped[name] = 0;
    for (const part of chunk(ids)) {
      const res = await M[name].deleteMany({ _id: { $in: part }, updatedAt: { $lte: plan.generatedAt } });
      const n = res && typeof res.deletedCount === 'number' ? res.deletedCount : 0;
      deleted[name] += n; skipped[name] += part.length - n;
    }
  }
  return { deleted, skippedBecauseChanged: skipped };
};

/** After execution: recompute everything and compare with the "before" state. */
const verify = async (M, before, result, opts) => {
  const after = await buildPlan(M, opts);
  const problems = [];
  for (const name of DELETE_ORDER) {
    const b = before.collections[name]; const a = after.collections[name];
    const expected = b.examined - result.deleted[name];
    if (a.examined !== expected) problems.push(`${name}: expected ${expected} records after cleanup, found ${a.examined}`);
    if (a.delete.length > result.skippedBecauseChanged[name]) problems.push(`${name}: ${a.delete.length} eligible old records still remain`);
  }
  for (const k of Object.keys(before.protectedCounts)) {
    if (after.protectedCounts[k] !== before.protectedCounts[k]) problems.push(`${k}: count changed (${before.protectedCounts[k]} → ${after.protectedCounts[k]})`);
  }
  // no certificate may point at a missing attempt
  const certs = await M.Certificate.find({}).select('attempt');
  let dangling = 0;
  for (const part of chunk(certs.map((x) => sid(x.attempt)))) {
    const found = await M.OlympiadAttempt.countDocuments({ _id: { $in: part } });
    dangling += part.length - found;
  }
  if (dangling) problems.push(`${dangling} certificate(s) reference an attempt that no longer exists`);
  return { ok: problems.length === 0, problems, after: summarise(after), danglingCertificates: dangling };
};

module.exports = { CUTOFF, CUTOFF_LABEL, CONFIRM_PHRASE, DELETE_ORDER, PROTECTED, buildPlan, summarise, writeArchive, executePlan, verify };
