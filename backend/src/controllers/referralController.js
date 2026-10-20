/** HTTP layer for Refer & Earn. All rules live in services/referrals.js and services/credits.js. */
const referrals = require('../services/referrals');
const credits = require('../services/credits');
const { getPrimaryClientUrl } = require('../config/clientUrls');

const handler = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) {
    if (err instanceof credits.CreditError) return res.status(err.status).json({ success: false, code: err.code, message: err.message, ...(err.extra || {}) });
    console.error('[referrals] unexpected error:', err);
    return res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'Something went wrong on our side. Please try again in a moment.' });
  }
};
const needStudent = (req) => {
  if (!req.user || req.user.role !== 'student') throw new credits.CreditError(403, 'NOT_A_STUDENT', 'Refer & Earn is available to student accounts.');
};
const sendCsv = (res, name, body) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(`﻿${body}`);
};
const stamp = () => new Date().toISOString().slice(0, 10);

// ── public / student ──────────────────────────────────────────────────────────────────────────
// GET /api/referrals/validate?code=  (public, rate limited per IP; never reveals who owns the code)
const validate = handler(async (req, res) => {
  const r = await referrals.validateCode(req.query.code);
  res.json({ success: true, valid: r.valid, message: r.message, reason: r.valid ? undefined : r.reason });
});

const me = handler(async (req, res) => {
  needStudent(req);
  const [ov, settings] = await Promise.all([referrals.myOverview(req.user), credits.getSettings()]);
  const s = credits.publicSettings(settings);
  res.json({
    success: true, ...ov, enabled: s.enabled, creditsPerReferral: s.creditsPerReferral,
    link: `${getPrimaryClientUrl()}/register?ref=${encodeURIComponent(ov.code)}`,
  });
});
const myReferrals = handler(async (req, res) => { needStudent(req); res.json({ success: true, ...(await referrals.myReferrals(req.user, req.query)) }); });
const myCredits = handler(async (req, res) => { needStudent(req); res.json({ success: true, ...(await referrals.myCredits(req.user, req.query)) }); });
const myBalance = handler(async (req, res) => { needStudent(req); res.json({ success: true, balance: await credits.getBalance(req.user._id) }); });

// ── admin ─────────────────────────────────────────────────────────────────────────────────────
const adminOverview = handler(async (req, res) => res.json({ success: true, ...(await referrals.overview({ days: req.query.days })) }));
const adminList = handler(async (req, res) => res.json({ success: true, ...(await referrals.listReferrals(req.query)) }));
const adminDetail = handler(async (req, res) => res.json({ success: true, referral: await referrals.referralDetail(req.params.id) }));
const adminReview = handler(async (req, res) => {
  const b = req.body || {};
  res.json({ success: true, referral: await referrals.review({ id: req.params.id, action: b.action, reason: b.reason, reverseReward: b.reverseReward, admin: req.user }) });
});
const adminTransactions = handler(async (req, res) => res.json({ success: true, ...(await referrals.listTransactions(req.query)) }));
const adminStudents = handler(async (req, res) => res.json({ success: true, ...(await referrals.listStudents(req.query)) }));
const adminGrant = handler(async (req, res) => {
  const b = req.body || {};
  const ids = Array.isArray(b.studentIds) ? b.studentIds.map(String) : [];
  const { batch, alreadyProcessed } = await credits.grantBatch({ admin: req.user, studentIds: ids, credits: b.credits, reason: b.reason, note: b.note, requestId: b.requestId, kind: b.kind });
  res.status(alreadyProcessed ? 200 : 201).json({ success: true, alreadyProcessed, batch: credits.batchView(batch) });
});
const adminAdjust = handler(async (req, res) => {
  const b = req.body || {};
  const r = await credits.adjust({ admin: req.user, studentId: b.studentId, delta: b.delta, reason: b.reason, requestId: b.requestId });
  res.json({ success: true, duplicate: r.duplicate, balance: await credits.getBalance(r.tx.student) });
});
const adminBatches = handler(async (req, res) => res.json({ success: true, ...(await referrals.listBatches(req.query)) }));
const adminBatch = handler(async (req, res) => res.json({ success: true, batch: await referrals.getBatch(req.params.batchId) }));
const adminSettings = handler(async (req, res) => res.json({ success: true, settings: credits.publicSettings(await credits.getSettings()) }));
const adminUpdateSettings = handler(async (req, res) => res.json({ success: true, settings: await credits.updateSettings(req.body, req.user) }));
const adminReconcile = handler(async (req, res) => res.json({ success: true, ...(await credits.reconcile({ repair: !!(req.body && req.body.repair) })) }));
const exportReferrals = handler(async (req, res) => sendCsv(res, `referrals-${stamp()}.csv`, await referrals.exportReferralsCsv(req.query)));
const exportTransactions = handler(async (req, res) => sendCsv(res, `credit-transactions-${stamp()}.csv`, await referrals.exportTransactionsCsv(req.query)));
const exportBatch = handler(async (req, res) => sendCsv(res, `credit-grant-${String(req.params.batchId).replace(/[^A-Za-z0-9-]/g, '')}.csv`, await referrals.exportBatchCsv(req.params.batchId)));

module.exports = {
  validate, me, myReferrals, myCredits, myBalance,
  adminOverview, adminList, adminDetail, adminReview, adminTransactions, adminStudents, adminGrant, adminAdjust, adminBatches, adminBatch,
  adminSettings, adminUpdateSettings, adminReconcile, exportReferrals, exportTransactions, exportBatch,
};
