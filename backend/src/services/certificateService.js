const crypto = require('crypto');
const { Certificate, Counter } = require('../models/Certificate');
const { OlympiadExam, OlympiadAttempt } = require('../models/Olympiad');
const User = require('../models/User');
const { getPrimaryClientUrl } = require('../config/clientUrls');

/**
 * Certificate rules — ALL of them are decided here, on the server, from the official stored result.
 * Nothing (percentage, grade, result, number, name, student) is ever accepted from a client.
 *
 *   percentage >= 60  → PASS → one certificate per (student, exam), created automatically
 *   percentage <  60  → FAIL → no certificate, no record
 *
 *   90–100 A+ · 80–89 A · 70–79 B+ · 60–69 B
 */
const PASS_PERCENTAGE = 60;
const GRADE_BANDS = [[90, 'A+'], [80, 'A'], [70, 'B+'], [60, 'B']];
const CERT_PREFIX = 'LQOLY';
const DISPLAY_TZ = 'Asia/Kolkata'; // the app's exam windows are defined in IST

const isDuplicateKey = (err) => err && (err.code === 11000 || err.code === 11001);

/** Grade for an official percentage, or null when the student did not pass. */
const gradeFor = (percentage) => {
  const p = Number(percentage);
  if (!Number.isFinite(p) || p < PASS_PERCENTAGE) return null;
  for (const [min, grade] of GRADE_BANDS) if (p >= min) return grade;
  return null;
};
const isPass = (percentage) => gradeFor(percentage) !== null;

/** Certificate-style ordinal for a standard: 1 → 1st, 2 → 2nd, 3 → 3rd, 10 → 10th */
const ordinal = (n) => {
  const v = Math.trunc(Number(n));
  const mod100 = v % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
  return `${v}${{ 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th'}`;
};

/** 92.5 → "92.5", 84 → "84", 84.333 → "84.33" (no trailing zeros) */
const formatPercentage = (p) => String(Number(Number(p).toFixed(2)));

/** "30 September 2026" (IST) — the date is produced from the stored issue instant, never hard-coded */
const formatIssueDate = (date) => new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: DISPLAY_TZ,
}).format(new Date(date));

const yearIST = (date) => Number(new Intl.DateTimeFormat('en-GB', { year: 'numeric', timeZone: DISPLAY_TZ }).format(new Date(date)));

/** An attempt's exam / student may arrive populated (a whole document) — always work with the plain id. */
const idOf = (ref) => (ref && ref._id ? ref._id : ref);

const cleanName = (name) => String(name || '').replace(/\s+/g, ' ').trim();

// ──────────────────────────────────────────────
// Certificate number — server-side, unique, sequential per Olympiad edition
// ──────────────────────────────────────────────
const nextSequence = async (prefix) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const counter = await Counter.findOneAndUpdate(
        { _id: `certificate:${prefix}` },
        { $inc: { seq: 1 } },
        { upsert: true, new: true }
      );
      return counter.seq;
    } catch (err) {
      // two workers creating the very first counter at the same instant: one loses the race — just retry
      if (isDuplicateKey(err) && attempt < 3) continue;
      throw err;
    }
  }
};

const formatNumber = (prefix, seq) => `${prefix}-${String(seq).padStart(6, '0')}`;

// ──────────────────────────────────────────────
// Issuing
// ──────────────────────────────────────────────
/**
 * Issue the certificate for a COMPLETED, evaluated attempt — if (and only if) the stored percentage passes.
 * Safe to call any number of times, concurrently or repeatedly: the same certificate is always returned.
 *
 * @returns {{ passed: boolean, certificate: object|null, created: boolean, reason?: string }}
 */
const issueForAttempt = async (attemptOrId, now = new Date()) => {
  const attempt = attemptOrId && attemptOrId._id && attemptOrId.percentage !== undefined
    ? attemptOrId
    : await OlympiadAttempt.findById(attemptOrId);
  if (!attempt) return { passed: false, certificate: null, created: false, reason: 'NO_ATTEMPT' };
  if (attempt.status !== 'COMPLETED' || !attempt.evaluatedAt) {
    return { passed: false, certificate: null, created: false, reason: 'NOT_EVALUATED' };
  }

  // The OFFICIAL result: the value the server wrote when it evaluated the attempt.
  const grade = gradeFor(attempt.percentage);
  if (!grade) return { passed: false, certificate: null, created: false, reason: 'BELOW_PASS_MARK' };

  const studentId = idOf(attempt.student);
  const examId = idOf(attempt.exam);
  const existing = await Certificate.findOne({ student: studentId, exam: examId });
  if (existing) return { passed: true, certificate: existing, created: false };

  const [exam, student] = await Promise.all([
    OlympiadExam.findById(examId),
    User.findById(studentId).select('name'),
  ]);
  if (!exam || !student) return { passed: true, certificate: null, created: false, reason: 'MISSING_EXAM_OR_STUDENT' };
  const studentName = cleanName(student.name);
  if (!studentName) return { passed: true, certificate: null, created: false, reason: 'STUDENT_NAME_MISSING' };

  const prefix = `${CERT_PREFIX}${yearIST(exam.startDate || now)}`;
  const seq = await nextSequence(prefix);

  try {
    const certificate = await Certificate.create({
      certificateNumber: formatNumber(prefix, seq),
      student: studentId,
      exam: examId,
      attempt: attempt._id,
      examName: exam.title,
      studentName,
      standard: String(exam.standard),
      percentage: attempt.percentage,
      grade,
      result: 'PASS',
      issueDate: now,
      verificationToken: crypto.randomBytes(24).toString('hex'),
      certificatePdfUrl: `/certificates/${formatNumber(prefix, seq)}/download`,
      status: 'VALID',
    });
    return { passed: true, certificate, created: true };
  } catch (err) {
    // Lost a race with another request for the same student + exam: hand back the winner's certificate.
    if (isDuplicateKey(err)) {
      const winner = await Certificate.findOne({ student: studentId, exam: examId });
      if (winner) return { passed: true, certificate: winner, created: false };
    }
    throw err;
  }
};

/** Best-effort wrapper for the exam flow: a certificate problem must NEVER break submitting an exam. */
const safeIssueForAttempt = async (attemptOrId, now) => {
  try {
    return await issueForAttempt(attemptOrId, now);
  } catch (err) {
    console.error('[certificates] issuing failed (the exam result is unaffected):', err.message);
    return { passed: null, certificate: null, created: false, reason: 'ERROR' };
  }
};

// ──────────────────────────────────────────────
// Serialisers — no MongoDB ids, no internal fields
// ──────────────────────────────────────────────
const verificationUrl = (cert) => `${getPrimaryClientUrl()}/verify-certificate/${encodeURIComponent(cert.certificateNumber)}`;

/** What a logged-in student (or admin) sees */
const toOwnerView = (c) => ({
  certificateNumber: c.certificateNumber,
  studentName: c.studentName,
  standard: c.standard,
  standardLabel: ordinal(c.standard),
  examName: c.examName,
  percentage: c.percentage,
  grade: c.grade,
  result: c.result,
  issueDate: c.issueDate,
  issueDateLabel: formatIssueDate(c.issueDate),
  status: c.status,
  revokedAt: c.revokedAt || null,
  downloadPath: `/certificates/${c.certificateNumber}/download`,
  verifyUrl: verificationUrl(c),
});

/** What the PUBLIC verification page sees. A revoked certificate exposes nothing but its number and status. */
const toPublicView = (c) => {
  if (c.status === 'REVOKED') {
    return { valid: false, status: 'REVOKED', certificateNumber: c.certificateNumber, revokedAt: c.revokedAt || null };
  }
  return {
    valid: true,
    status: 'VALID',
    certificateNumber: c.certificateNumber,
    studentName: c.studentName,
    standard: c.standard,
    standardLabel: ordinal(c.standard),
    examName: c.examName,
    percentage: c.percentage,
    grade: c.grade,
    result: c.result,
    issueDate: c.issueDate,
    issueDateLabel: formatIssueDate(c.issueDate),
  };
};

/** Pass / fail outcome derived from the OFFICIAL stored percentage — attached to the student's result payload */
const outcomeFor = (percentage) => {
  const grade = gradeFor(percentage);
  return { passed: grade !== null, result: grade ? 'PASS' : 'FAIL', grade, passPercentage: PASS_PERCENTAGE };
};

// ──────────────────────────────────────────────
// Admin
// ──────────────────────────────────────────────
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildAdminFilter = (q = {}) => {
  const filter = {};
  const search = String(q.search || '').trim().slice(0, 60);
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: 'i' };
    filter.$or = [{ certificateNumber: rx }, { studentName: rx }];
  }
  if (q.standard && q.standard !== 'all') filter.standard = String(q.standard);
  if (q.exam && q.exam !== 'all' && /^[a-f0-9]{24}$/i.test(String(q.exam))) filter.exam = String(q.exam);
  if (q.grade && q.grade !== 'all' && GRADE_BANDS.some(([, g]) => g === q.grade)) filter.grade = q.grade;
  if (q.status && ['VALID', 'REVOKED'].includes(q.status)) filter.status = q.status;
  const from = q.from ? new Date(`${q.from}T00:00:00+05:30`) : null; // filter dates are IST calendar days
  const to = q.to ? new Date(`${q.to}T23:59:59.999+05:30`) : null;
  if ((from && !Number.isNaN(from.getTime())) || (to && !Number.isNaN(to.getTime()))) {
    filter.issueDate = {};
    if (from && !Number.isNaN(from.getTime())) filter.issueDate.$gte = from;
    if (to && !Number.isNaN(to.getTime())) filter.issueDate.$lte = to;
  }
  return filter;
};

const revokeCertificate = async (certificateNumber, adminId, reason, now = new Date()) => {
  const updated = await Certificate.findOneAndUpdate(
    { certificateNumber, status: 'VALID' },
    { $set: { status: 'REVOKED', revokedAt: now, revokedBy: adminId, revokeReason: String(reason || '').trim().slice(0, 300) } },
    { new: true }
  );
  if (updated) return { certificate: updated, changed: true };
  const current = await Certificate.findOne({ certificateNumber });
  return { certificate: current, changed: false }; // already revoked (idempotent) or not found
};

const reinstateCertificate = async (certificateNumber, adminId, now = new Date()) => {
  const updated = await Certificate.findOneAndUpdate(
    { certificateNumber, status: 'REVOKED' },
    { $set: { status: 'VALID', reinstatedAt: now, reinstatedBy: adminId }, $unset: { revokedAt: '', revokeReason: '' } },
    { new: true }
  );
  if (updated) return { certificate: updated, changed: true };
  const current = await Certificate.findOne({ certificateNumber });
  return { certificate: current, changed: false };
};

module.exports = {
  PASS_PERCENTAGE, GRADE_BANDS, CERT_PREFIX,
  gradeFor, isPass, ordinal, formatPercentage, formatIssueDate, yearIST, formatNumber,
  issueForAttempt, safeIssueForAttempt, outcomeFor,
  verificationUrl, toOwnerView, toPublicView,
  buildAdminFilter, revokeCertificate, reinstateCertificate, escapeRegex,
};
