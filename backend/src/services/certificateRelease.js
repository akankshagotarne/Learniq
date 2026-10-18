const { Certificate } = require('../models/Certificate');
const { OlympiadExam, OlympiadAttempt } = require('../models/Olympiad');
const svc = require('./certificateService');
const pdf = require('./certificateCompletionPdf');
const { buildPdfContext } = require('./certificateContext');
const release = require('./resultsRelease');

/**
 * Releases the certificates once the official results are published (config/resultsRelease.js: 18 Oct 2026, 6:00 PM IST).
 *
 * For EVERY successfully submitted attempt - whatever its score, interview or not - both certificates (RESULT + PARTICIPATION) are
 * created and each is then proven producible by really rendering its PDF; only then is it marked GENERATED and offered to the student.
 * Everything is idempotent and safe to run twice, concurrently, or after a restart:
 *   - records are created through unique (student, exam, type) indexes;
 *   - GENERATED is written by a status-conditioned update;
 *   - a student whose certificate fails (FAILED, retried on the next sweep) never blocks the others;
 *   - the exam is marked `certificatesReleasedAt` only after every attempt succeeded, so unfinished work is retried automatically.
 * No state lives in memory: the schedule is on the exam document, so a Render restart cannot lose it.
 */
const BATCH = 100;

/** Prove the certificate can be produced (build its data + render the real PDF), then mark it GENERATED. Never throws. */
const ensureGenerated = async (cert, now = new Date()) => {
  if (!cert) return { ok: false, reason: 'MISSING' };
  if (!cert.generationStatus || cert.generationStatus === 'GENERATED') return { ok: true, already: true }; // legacy certificates count as generated
  try {
    const buffer = await pdf.renderCompletionPdf(await buildPdfContext(cert));
    if (!Buffer.isBuffer(buffer) || buffer.length < 1000) throw Object.assign(new Error('empty pdf'), { code: 'EMPTY_PDF' });
    await Certificate.updateOne(
      { _id: cert._id, generationStatus: { $ne: 'GENERATED' } },
      { $set: { generationStatus: 'GENERATED', generatedAt: now }, $unset: { generationError: 1 } },
    );
    return { ok: true };
  } catch (err) {
    const code = String((err && err.code) || 'RENDER_FAILED').slice(0, 60); // a code, never student data
    console.error(`[certificates] ${cert.certificateNumber} could not be generated (${code}); it will be retried`);
    try {
      await Certificate.updateOne({ _id: cert._id, generationStatus: { $ne: 'GENERATED' } }, { $set: { generationStatus: 'FAILED', generationError: code }, $inc: { generationAttempts: 1 } });
    } catch (e) { /* best effort: the next sweep retries anyway */ }
    return { ok: false, reason: code };
  }
};

/** Both certificates for one attempt: create what is missing, then generate what is not generated yet. */
const processAttempt = async (attempt, now = new Date()) => {
  let a = attempt;
  if (a.status === 'COMPLETED' && !a.evaluatedAt) {
    // submitted but never evaluated (an earlier failure): evaluate it now, the same server-side way as at submission
    a = await require('../controllers/olympiadController')._internals.ensureEvaluated(a);
  }
  const issued = await svc.issueForAttempt(a, now);
  if (!issued.eligible) return { eligible: false, ok: true, reason: issued.reason };
  const results = await Promise.all([issued.certificate, issued.participation].map((c) => (c ? ensureGenerated(c, now) : { ok: false, reason: 'NOT_ISSUED' })));
  const fresh = async (c) => (c ? Certificate.findById(c._id) : null);
  return { eligible: true, ok: results.every((r) => r.ok), created: issued.created, certificate: await fresh(issued.certificate), participation: await fresh(issued.participation) };
};

/** Process every submitted attempt of an exam in batches. Only call for an exam whose results are released. */
const processExam = async (examOrId, now = new Date()) => {
  const exam = examOrId && examOrId._id ? examOrId : await OlympiadExam.findById(examOrId);
  if (!exam) return { ok: false, reason: 'NO_EXAM' };
  if (exam.examType === 'engineering') return { ok: true, skipped: true };
  if (!release.isReleased(exam, now)) return { ok: false, reason: 'NOT_RELEASED' }; // never before the official release
  const stats = { processed: 0, created: 0, failed: 0 };
  let last = null;
  for (;;) {
    const filter = { exam: exam._id, status: 'COMPLETED' };
    if (last) filter._id = { $gt: last };
    const batch = await OlympiadAttempt.find(filter).sort({ _id: 1 }).limit(BATCH);
    if (!batch.length) break;
    for (const attempt of batch) {
      last = attempt._id;
      try {
        const r = await processAttempt(attempt, now);
        stats.processed += 1;
        if (r.created) stats.created += 1;
        if (!r.ok) stats.failed += 1;
      } catch (err) {
        stats.failed += 1;
        console.error('[certificates] an attempt could not be processed (the others continue):', err.message);
      }
    }
    if (batch.length < BATCH) break;
  }
  if (stats.failed === 0) {
    await OlympiadExam.updateOne({ _id: exam._id, certificatesReleasedAt: null }, { $set: { certificatesReleasedAt: now } });
  }
  return { ok: stats.failed === 0, ...stats };
};

/** A student's own submitted attempts on released exams (used when they open their certificates - covers a late / sleeping sweeper). */
const ensureForStudent = async (studentId, now = new Date()) => {
  const attempts = await OlympiadAttempt.find({ student: studentId, status: 'COMPLETED' });
  for (const attempt of attempts) {
    const exam = await OlympiadExam.findById(attempt.exam).select('examType resultsPublishedAt resultsPublishAt');
    if (!exam || exam.examType === 'engineering' || !release.isReleased(exam, now)) continue;
    try { await processAttempt(attempt, now); } catch (err) { console.error('[certificates] on-demand generation failed:', err.message); }
  }
};

let running = false;
/** One sweep: schedule → publish what is due → generate certificates for released exams that are not finished. */
const sweep = async (now = new Date()) => {
  if (running) return { skipped: true };
  running = true;
  try {
    await release.seedSchedule(now);
    const published = await release.publishDue(now);
    if (published.length) console.log(`[results] published at the scheduled time: ${published.map((e) => `Std ${e.standard}`).join(', ')}`);
    const exams = await OlympiadExam.find({
      examType: { $ne: 'engineering' }, certificatesReleasedAt: null,
      $or: [{ resultsPublishedAt: { $ne: null } }, { resultsPublishAt: { $lte: now } }],
    });
    const out = [];
    for (const exam of exams) out.push({ exam: String(exam._id), ...(await processExam(exam, now)) });
    return { published: published.length, exams: out };
  } finally { running = false; }
};

const startCertificateSweeper = (intervalMs = 60 * 1000) => {
  if (process.env.NODE_ENV === 'test') return { started: false, reason: 'test environment' };
  const tick = () => sweep().catch((err) => console.error('[certificates] sweep failed (will retry):', err.message));
  setTimeout(tick, 5000).unref();
  setInterval(tick, intervalMs).unref();
  return { started: true };
};

module.exports = { ensureGenerated, processAttempt, processExam, ensureForStudent, sweep, startCertificateSweeper };
