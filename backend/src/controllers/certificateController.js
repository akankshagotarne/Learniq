const mongoose = require('mongoose');
const { Certificate } = require('../models/Certificate');
const { OlympiadExam, OlympiadAttempt } = require('../models/Olympiad');
const svc = require('../services/certificateService');
const { renderCertificatePdf } = require('../services/certificatePdf');

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
const sameId = (a, b) => String(a) === String(b);

/** Load a certificate the caller may see: its owner, or an admin. Anyone else gets a plain 404 (no existence leak). */
const loadAccessible = async (req) => {
  const number = parseNumber(req.params.certificateNumber);
  const cert = await Certificate.findOne({ certificateNumber: number });
  if (!cert || (!isAdmin(req.user) && !sameId(cert.student, req.user._id))) {
    throw new ApiError(404, 'Certificate not found.', 'NOT_FOUND');
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
  res.status(created ? 201 : 200).json({ success: true, created, certificate: svc.toOwnerView(certificate) });
});

// GET /api/certificates/mine
const mine = handler(async (req, res) => {
  const rows = await Certificate.find({ student: req.user._id }).sort({ createdAt: -1 });
  res.json({ success: true, certificates: rows.map(svc.toOwnerView) });
});

// GET /api/certificates/:certificateNumber   (owner or admin)
const getOne = handler(async (req, res) => {
  const cert = await loadAccessible(req);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, certificate: svc.toOwnerView(cert) });
});

// GET /api/certificates/:certificateNumber/download[?disposition=inline]   (owner or admin)
const download = handler(async (req, res) => {
  const cert = await loadAccessible(req);
  if (cert.status === 'REVOKED' && !isAdmin(req.user)) {
    throw new ApiError(403, 'This certificate has been revoked and can no longer be downloaded.', 'CERTIFICATE_REVOKED');
  }
  const pdf = await renderCertificatePdf(cert, svc.verificationUrl(cert));
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
  const raw = String(req.params.certificateNumber || '').trim();
  let cert = null;
  if (NUMBER_RE.test(raw.toUpperCase())) cert = await Certificate.findOne({ certificateNumber: raw.toUpperCase() });
  else if (TOKEN_RE.test(raw.toLowerCase())) cert = await Certificate.findOne({ verificationToken: raw.toLowerCase() });
  res.setHeader('Cache-Control', 'no-store'); // a revocation must show up immediately
  if (!cert) return res.status(404).json({ success: false, valid: false, code: 'NOT_FOUND', message: 'No certificate matches this number.' });
  res.json({ success: true, ...svc.toPublicView(cert) });
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
    certificates: rows.map((c) => ({ ...svc.toOwnerView(c), examId: String(c.exam), revokeReason: c.revokeReason || null })),
    page, limit, total, pages: Math.max(1, Math.ceil(total / limit)),
    summary: { total: validCount + revokedCount, valid: validCount, revoked: revokedCount },
  });
});

// POST /api/certificates/admin/:certificateNumber/revoke   body: { reason? }
const adminRevoke = handler(async (req, res) => {
  const number = parseNumber(req.params.certificateNumber);
  const { certificate, changed } = await svc.revokeCertificate(number, req.user._id, req.body && req.body.reason);
  if (!certificate) throw new ApiError(404, 'Certificate not found.', 'NOT_FOUND');
  res.json({ success: true, changed, certificate: svc.toOwnerView(certificate) });
});

// POST /api/certificates/admin/:certificateNumber/reinstate
const adminReinstate = handler(async (req, res) => {
  const number = parseNumber(req.params.certificateNumber);
  const { certificate, changed } = await svc.reinstateCertificate(number, req.user._id);
  if (!certificate) throw new ApiError(404, 'Certificate not found.', 'NOT_FOUND');
  res.json({ success: true, changed, certificate: svc.toOwnerView(certificate) });
});

module.exports = { generate, mine, getOne, download, verify, adminList, adminRevoke, adminReinstate };
