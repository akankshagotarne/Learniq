const mongoose = require('mongoose');
const { Certificate } = require('../models/Certificate');
const { OlympiadExam, OlympiadAttempt } = require('../models/Olympiad');
const svc = require('../services/certificateService');
const { renderCompletionPdf } = require('../services/certificateCompletionPdf');
const { buildContext, effectiveIssueDate, maskName, CertificateDataError } = require('../services/certificateContext');

/**
 * Certificates API. Rules (who passed, which grade, which number) live in services/certificateService.js and are
 * derived from the official stored result — nothing in a request body can influence them.
 */
class ApiError extends Error {
  constructor(status, message, code, extra = {}) {
    super(message);
    this.status = status; this.code = code; this.extra = extra;
  }
}

const handler = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof ApiError) {
      return res.status(err.status).json({ success: false, message: err.message, code: err.code, ...err.extra });
    }
    if (err instanceof CertificateDataError) {
      console.error('[certificates] inconsistent certificate data:', err.code, err.message);
      return res.status(409).json({ success: false, code: err.code, message: err.message });
    }
    console.error('[certificates] unexpected error:', err);
    return res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'Something went wrong on our side. Please try again in a moment.' });
  }
};

const NUMBER_RE = /^[A-Z]{3,8}\d{4}-\d{6,9}$/;
const TOKEN_RE = /^[a-f0-9]{48}$/;
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

const parseNumber = (raw) => {
  const n = String(raw || '').trim().toUpperCase();
  if (!NUMBER_RE.test(n)) throw new ApiError(404, 'Certificate not found.', 'NOT_FOUND');
  return n;
};

const isAdmin = (user) => user && user.role === 'admin';
/** A certificate reveals pass/fail and the grade, so a student gets it only once the exam's results are published. */
const releasedExamIds = async (examIds) => {
  const exams = await OlympiadExam.find({ _id: { $in: examIds } }).select('examType resultsPublishedAt');
  return new Set(exams.filter((e) => e.examType === 'engineering' || e.resultsPublishedAt).map((e) => String(e._id)));
};
const sameId = (a, b) => String(a) === String(b);

/** Owner / admin views carry the date the certificate was actually issued (results publication), same as the PDF. */
const ownerViews = async (certs) => {
  const ids = [...new Set(certs.map((c) => String(c.exam)))];
  const exams = ids.length ? await OlympiadExam.find({ _id: { $in: ids } }).select('resultsPublishedAt') : [];
  const byId = new Map(exams.map((e) => [String(e._id), e]));
  return certs.map((c) => svc.toOwnerView(c, effectiveIssueDate(c, byId.get(String(c.exam)))));
};

/** Load a certificate the caller may see: its owner, or an admin. Anyone else gets a plain 404 (no existence leak). */
const loadAccessible = async (req) => {
  const number = parseNumber(req.params.certificateNumber);
  const cert = await Certificate.findOne({ certificateNumber: number });
  if (!cert || (!isAdmin(req.user) && !sameId(cert.student, req.user._id))) {
    throw new ApiError(404, 'Certificate not found.', 'NOT_FOUND');
  }
  if (!isAdmin(req.user) && !(await releasedExamIds([cert.exam])).has(String(cert.exam))) {
    throw new ApiError(404, 'Certificate not found.', 'NOT_FOUND'); // results unpublished: no hint that one exists
  }
  return cert;
};

// ──────────────────────────────────────────────
// Student
// ──────────────────────────────────────────────
// POST /api/certificates/generate   body: { examId }   ← the ONLY input; everything else comes from the database
const generate = handler(async (req, res) => {
  if (req.user.role !== 'student') throw new ApiError(403, 'Only students receive certificates.', 'NOT_A_STUDENT');
  const examId = String((req.body && req.body.examId) || '');
  if (!OBJECT_ID_RE.test(examId)) throw new ApiError(400, 'A valid examId is required.', 'INVALID_EXAM');

  const exam = await OlympiadExam.findById(examId);
  if (!exam) throw new ApiError(404, 'Examination not found.', 'EXAM_NOT_FOUND');
  let attempt = await OlympiadAttempt.findOne({ student: req.user._id, exam: exam._id });
  if (!attempt) throw new ApiError(404, 'You have not attempted this examination.', 'NO_ATTEMPT');
  if (attempt.status !== 'COMPLETED') {
    throw new ApiError(409, 'Your certificate is available after you submit the examination.', 'NOT_SUBMITTED');
  }
  if (!exam.resultsPublishedAt && exam.examType !== 'engineering') {
    throw new ApiError(403, 'Your results and certificate will be available after the results are officially published.', 'RESULT_NOT_PUBLISHED');
  }
  // make sure the official result exists (idempotent, backend-only evaluation)
  attempt = await require('./olympiadController')._internals.ensureEvaluated(attempt);

  const outcome = svc.outcomeFor(attempt.percentage);
  if (!outcome.passed) {
    throw new ApiError(403, `A minimum of ${svc.PASS_PERCENTAGE}% is required to receive a certificate.`, 'BELOW_PASS_MARK', {
      result: 'FAIL', percentage: attempt.percentage, passPercentage: svc.PASS_PERCENTAGE,
    });
  }
  const { certificate, created, reason } = await svc.issueForAttempt(attempt);
  if (!certificate) throw new ApiError(500, 'The certificate could not be created right now. Please try again.', reason || 'ISSUE_FAILED');
  res.status(created ? 201 : 200).json({ success: true, created, certificate: (await ownerViews([certificate]))[0] });
});

// GET /api/certificates/mine
const mine = handler(async (req, res) => {
  const all = await Certificate.find({ student: req.user._id }).sort({ createdAt: -1 });
  const released = await releasedExamIds(all.map((c) => c.exam));
  const rows = all.filter((c) => released.has(String(c.exam)));
  res.json({ success: true, certificates: await ownerViews(rows) });
});

// GET /api/certificates/:certificateNumber   (owner or admin)
const getOne = handler(async (req, res) => {
  const cert = await loadAccessible(req);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, certificate: (await ownerViews([cert]))[0] });
});

// GET /api/certificates/:certificateNumber/download[?disposition=inline]   (owner or admin)
const download = handler(async (req, res) => {
  const cert = await loadAccessible(req);
  if (cert.status === 'REVOKED' && !isAdmin(req.user)) {
    throw new ApiError(403, 'This certificate has been revoked and can no longer be downloaded.', 'CERTIFICATE_REVOKED');
  }
  // rendered fresh from the authoritative records on every request — the PDF is never stored, so it can never be stale
  const pdf = await renderCompletionPdf(await buildContext(cert));
  const inline = req.query.disposition === 'inline';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="LearnIQ-Certificate-${cert.certificateNumber}.pdf"`);
  res.setHeader('Content-Length', pdf.length);
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(pdf);
});

// ──────────────────────────────────────────────
// Public verification (no login)
// ──────────────────────────────────────────────
// GET /api/certificates/verify/:certificateNumber   (the number from the QR code; the long verification token also works)
const verify = handler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); // a revocation must show up immediately
  res.setHeader('X-Robots-Tag', 'noindex');
  const raw = String(req.params.certificateNumber || '').trim().slice(0, 80);
  let cert = null;
  let byNumber = false;
  if (NUMBER_RE.test(raw.toUpperCase())) { byNumber = true; cert = await Certificate.findOne({ certificateNumber: raw.toUpperCase() }); }
  else if (TOKEN_RE.test(raw.toLowerCase())) cert = await Certificate.findOne({ verificationToken: raw.toLowerCase() });
  if (!cert) {
    return res.status(404).json({ success: false, valid: false, status: 'INVALID', code: 'NOT_FOUND', message: 'No LearnIQ certificate matches this number.' });
  }
  // tamper check: the QR carries a short HMAC tag of the number; a mismatch means the link was edited or invented
  const integrity = byNumber ? svc.checkSignature(cert, req.query.t) : 'NOT_PROVIDED';
  if (integrity === 'MISMATCH') {
    return res.json({ success: true, valid: false, status: 'INVALID', code: 'MISMATCH', integrity, certificateNumber: cert.certificateNumber, message: 'This verification link does not match the certificate. It may have been altered — do not rely on it.' });
  }
  if (cert.status === 'REVOKED') return res.json({ success: true, integrity, ...svc.toPublicView(cert) });

  const exam = await OlympiadExam.findById(cert.exam).select('examType resultsPublishedAt');
  if (!exam || (exam.examType !== 'engineering' && !exam.resultsPublishedAt)) {
    // results not officially published yet: the certificate exists but is not issued — never reported as VALID
    return res.json({ success: true, valid: false, status: 'PENDING', integrity, certificateNumber: cert.certificateNumber, message: 'This certificate has not been issued yet. Results are published on the declaration date.' });
  }
  const ctx = await buildContext(cert); // throws CertificateDataError → 409, never a half-true "valid"
  res.json({
    success: true, ...svc.toPublicView(cert), integrity,
    studentName: maskName(cert.studentName),
    scoreLabel: ctx.scoreLabel, interviewStatus: ctx.interviewStatus, resultLabel: ctx.resultLabel,
    issueDate: ctx.issueDate, issueDateLabel: ctx.issueDateLabel,
  });
});

// ──────────────────────────────────────────────
// Admin
// ──────────────────────────────────────────────
// GET /api/certificates/admin/list?search=&standard=&exam=&grade=&status=&from=YYYY-MM-DD&to=YYYY-MM-DD&page=&limit=
const adminList = handler(async (req, res) => {
  const filter = svc.buildAdminFilter(req.query);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const [total, rows, validCount, revokedCount] = await Promise.all([
    Certificate.countDocuments(filter),
    Certificate.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Certificate.countDocuments({ status: 'VALID' }),
    Certificate.countDocuments({ status: 'REVOKED' }),
  ]);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({
    success: true,
    certificates: (await ownerViews(rows)).map((v, i) => ({ ...v, examId: String(rows[i].exam), revokeReason: rows[i].revokeReason || null })),
    page, limit, total, pages: Math.max(1, Math.ceil(total / limit)),
    summary: { total: validCount + revokedCount, valid: validCount, revoked: revokedCount },
  });
});

// POST /api/certificates/admin/:certificateNumber/revoke   body: { reason? }
const adminRevoke = handler(async (req, res) => {
  const number = parseNumber(req.params.certificateNumber);
  const { certificate, changed } = await svc.revokeCertificate(number, req.user._id, req.body && req.body.reason);
  if (!certificate) throw new ApiError(404, 'Certificate not found.', 'NOT_FOUND');
  res.json({ success: true, changed, certificate: (await ownerViews([certificate]))[0] });
});

// POST /api/certificates/admin/:certificateNumber/reinstate
const adminReinstate = handler(async (req, res) => {
  const number = parseNumber(req.params.certificateNumber);
  const { certificate, changed } = await svc.reinstateCertificate(number, req.user._id);
  if (!certificate) throw new ApiError(404, 'Certificate not found.', 'NOT_FOUND');
  res.json({ success: true, changed, certificate: (await ownerViews([certificate]))[0] });
});

module.exports = { generate, mine, getOne, download, verify, adminList, adminRevoke, adminReinstate };
