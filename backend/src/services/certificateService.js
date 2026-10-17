const crypto = require('crypto');
const { Certificate, Counter } = require('../models/Certificate');
const { OlympiadExam, OlympiadAttempt } = require('../models/Olympiad');
const User = require('../models/User');
const { getPrimaryClientUrl } = require('../config/clientUrls');

/**
 * Certificate rules — ALL of them are decided here, on the server, from the official stored result.
 * Nothing (percentage, grade, result, number, name, student) is ever accepted from a client.
 *
 * ELIGIBILITY: a successfully SUBMITTED (COMPLETED + evaluated) Olympiad attempt. Marks do not matter: every such student gets BOTH
 *   · the percentage/grade RESULT certificate (type RESULT)        — shows the real percentage; grade only from 60% up
 *   · the PARTICIPATION certificate (type PARTICIPATION)
 * Registering, paying or merely starting an exam is not a submission and earns nothing.
 *
 * GRADING is unchanged and is reporting only (it no longer gates anything):
 *   90–100 A+ · 80–89 A · 70–79 B+ · 60–69 B · below 60 → no grade, result "Below pass mark"
 */
const PASS_PERCENTAGE = 60;
const GRADE_BANDS = [[90, 'A+'], [80, 'A'], [70, 'B+'], [60, 'B']];
const CERT_PREFIX = 'LQOLY';
const PARTICIPATION_PREFIX = 'LQPAR';
const TYPES = { RESULT: 'RESULT', PARTICIPATION: 'PARTICIPATION' };
const prefixFor = (type) => (type === TYPES.PARTICIPATION ? PARTICIPATION_PREFIX : CERT_PREFIX);
const TYPE_LABELS = { RESULT: 'Result Certificate', PARTICIPATION: 'Participation Certificate' };
/** Legacy certificates have no type: anything that is not PARTICIPATION is a RESULT certificate. */
const typeFilter = (type) => (type === TYPES.PARTICIPATION ? { type: TYPES.PARTICIPATION } : { type: { $ne: TYPES.PARTICIPATION } });
const typeOf = (cert) => (cert && cert.type === TYPES.PARTICIPATION ? TYPES.PARTICIPATION : TYPES.RESULT);
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
/** A submission is valid when the attempt is COMPLETED and the server has evaluated it. Nothing about the score is checked. */
const isSubmitted = (attempt) => Boolean(attempt && attempt.status === 'COMPLETED' && attempt.evaluatedAt);

/**
 * Create (or return) ONE certificate of the given type for a submitted attempt. Idempotent and race-safe: the unique index on
 * (student, exam, type) decides, and the loser of a race gets the winner's record back.
 * @returns {{ certificate: object|null, created: boolean, reason?: string }}
 */
const issueCertificate = async (attempt, type, now = new Date()) => {
  const studentId = idOf(attempt.student);
  const examId = idOf(attempt.exam);
  const existing = await Certificate.findOne({ student: studentId, exam: examId, ...typeFilter(type) });
  if (existing) return { certificate: existing, created: false };

  const [exam, student] = await Promise.all([
    OlympiadExam.findById(examId),
    User.findById(studentId).select('name'),
  ]);
  if (!exam || !student) return { certificate: null, created: false, reason: 'MISSING_EXAM_OR_STUDENT' };
  if (exam.examType === 'engineering') return { certificate: null, created: false, reason: 'NOT_APPLICABLE' }; // the free mock test has none
  const studentName = cleanName(student.name);
  if (!studentName) return { certificate: null, created: false, reason: 'STUDENT_NAME_MISSING' };

  const grade = type === TYPES.RESULT ? gradeFor(attempt.percentage) : null; // grading rules untouched; < 60% simply has no grade
  const result = type === TYPES.PARTICIPATION ? 'PARTICIPATED' : (grade ? 'PASS' : 'BELOW_PASS');
  const prefix = `${prefixFor(type)}${yearIST(exam.startDate || now)}`;
  const seq = await nextSequence(prefix);
  const number = formatNumber(prefix, seq);
  try {
    const certificate = await Certificate.create({
      certificateNumber: number,
      type,
      student: studentId,
      exam: examId,
      attempt: attempt._id,
      examName: exam.title,
      studentName,
      standard: String(exam.standard),
      percentage: attempt.percentage,
      grade,
      result,
      issueDate: now,
      verificationToken: crypto.randomBytes(24).toString('hex'),
      certificatePdfUrl: `/certificates/${number}/download`,
      generationStatus: 'PENDING',
      status: 'VALID',
    });
    return { certificate, created: true };
  } catch (err) {
    // Lost a race with another request / worker for the same student + exam + type: hand back the winner's certificate.
    if (isDuplicateKey(err)) {
      const winner = await Certificate.findOne({ student: studentId, exam: examId, ...typeFilter(type) });
      if (winner) return { certificate: winner, created: false };
    }
    throw err;
  }
};

/**
 * Issue BOTH certificates for a submitted attempt, whatever its score. Safe to call any number of times.
 * One failing type never blocks the other: each is tracked on its own.
 * @returns {{ eligible: boolean, certificate: object|null, participation: object|null, created: boolean, reason?: string, errors?: string[] }}
 */
const issueForAttempt = async (attemptOrId, now = new Date()) => {
  const attempt = attemptOrId && attemptOrId._id && attemptOrId.percentage !== undefined
    ? attemptOrId
    : await OlympiadAttempt.findById(attemptOrId);
  if (!attempt) return { eligible: false, certificate: null, participation: null, created: false, reason: 'NO_ATTEMPT' };
  if (!isSubmitted(attempt)) return { eligible: false, certificate: null, participation: null, created: false, reason: 'NOT_SUBMITTED' };

  const out = { eligible: true, certificate: null, participation: null, created: false, errors: [] };
  for (const [key, type] of [['certificate', TYPES.RESULT], ['participation', TYPES.PARTICIPATION]]) {
    try {
      const r = await issueCertificate(attempt, type, now);
      out[key] = r.certificate; out.created = out.created || r.created;
      if (!r.certificate && r.reason) { out.reason = out.reason || r.reason; out.errors.push(`${type}:${r.reason}`); }
    } catch (err) {
      console.error(`[certificates] ${type} certificate could not be issued:`, err.message);
      out.errors.push(`${type}:ERROR`); out.reason = out.reason || 'ERROR';
    }
  }
  return out;
};

/** Best-effort wrapper for the exam flow: a certificate problem must NEVER break submitting an exam. */
const safeIssueForAttempt = async (attemptOrId, now) => {
  try {
    return await issueForAttempt(attemptOrId, now);
  } catch (err) {
    console.error('[certificates] issuing failed (the exam result is unaffected):', err.message);
    return { eligible: null, certificate: null, participation: null, created: false, reason: 'ERROR' };
  }
};

// ──────────────────────────────────────────────
// Serialisers — no MongoDB ids, no internal fields
// ──────────────────────────────────────────────
const PRODUCTION_SITE = 'https://www.learniq.study';
/**
 * Public site the QR code points to. CERTIFICATE_VERIFY_BASE_URL wins; otherwise the primary CLIENT_URL; a certificate
 * must never carry a non-HTTPS (or localhost) link, so anything else falls back to the production domain.
 */
const verifyBaseUrl = () => {
  const candidate = String(process.env.CERTIFICATE_VERIFY_BASE_URL || getPrimaryClientUrl()).trim().replace(/\/+$/, '');
  return /^https:\/\/[^\s/]+$/i.test(candidate) && !/localhost|127\.0\.0\.1/i.test(candidate) ? candidate : PRODUCTION_SITE;
};

/**
 * Integrity tag printed inside the QR URL: HMAC(number) keyed with the certificate's secret verificationToken (never
 * printed). A QR whose number was edited — or invented — cannot carry a matching tag.
 */
const qrSignature = (cert) => crypto.createHmac('sha256', String(cert.verificationToken || '')).update(String(cert.certificateNumber)).digest('hex').slice(0, 16);
const SIGNATURE_RE = /^[a-f0-9]{16}$/;
const checkSignature = (cert, provided) => {
  if (provided === undefined || provided === null || provided === '') return 'NOT_PROVIDED';
  const p = String(provided).toLowerCase();
  if (!SIGNATURE_RE.test(p)) return 'MISMATCH';
  const a = Buffer.from(p); const b = Buffer.from(qrSignature(cert));
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? 'MATCH' : 'MISMATCH';
};

const verificationUrl = (cert) => `${verifyBaseUrl()}/verify-certificate/${encodeURIComponent(cert.certificateNumber)}?t=${qrSignature(cert)}`;

/** What a logged-in student (or admin) sees */
const toOwnerView = (c, issueDate = c.issueDate) => ({
  certificateNumber: c.certificateNumber,
  type: typeOf(c),
  typeLabel: TYPE_LABELS[typeOf(c)],
  generationStatus: c.generationStatus || 'GENERATED',
  studentName: c.studentName,
  standard: c.standard,
  standardLabel: ordinal(c.standard),
  examName: c.examName,
  percentage: c.percentage,
  grade: c.grade,
  result: c.result,
  issueDate,
  issueDateLabel: formatIssueDate(issueDate),
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
  if (typeOf(c) === TYPES.PARTICIPATION) {
    // a participation certificate says nothing about marks: no percentage, grade or result on its public page
    return {
      valid: true, status: 'VALID', type: TYPES.PARTICIPATION, typeLabel: TYPE_LABELS.PARTICIPATION,
      certificateNumber: c.certificateNumber, studentName: c.studentName,
      standard: c.standard, standardLabel: ordinal(c.standard), examName: c.examName,
      issueDate: c.issueDate, issueDateLabel: formatIssueDate(c.issueDate),
    };
  }
  return {
    valid: true,
    status: 'VALID',
    type: TYPES.RESULT, typeLabel: TYPE_LABELS.RESULT,
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
  if (q.type === TYPES.PARTICIPATION) filter.type = TYPES.PARTICIPATION;
  else if (q.type === TYPES.RESULT) filter.type = { $ne: TYPES.PARTICIPATION };
  if (q.generation && ['PENDING', 'GENERATED', 'FAILED'].includes(q.generation)) filter.generationStatus = q.generation;
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
  PASS_PERCENTAGE, GRADE_BANDS, CERT_PREFIX, PARTICIPATION_PREFIX, TYPES, TYPE_LABELS, typeFilter, typeOf, isSubmitted,
  gradeFor, isPass, issueCertificate, ordinal, formatPercentage, formatIssueDate, yearIST, formatNumber,
  issueForAttempt, safeIssueForAttempt, outcomeFor,
  verificationUrl, verifyBaseUrl, qrSignature, checkSignature, toOwnerView, toPublicView,
  buildAdminFilter, revokeCertificate, reinstateCertificate, escapeRegex,
};
