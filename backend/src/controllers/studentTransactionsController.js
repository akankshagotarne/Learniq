const svc = require('../services/studentTransactions');
const pdf = require('../services/receiptPdf');

/** Student-only. Role enforcement is on the route; the student is ALWAYS req.user (never read from the URL, query or body). */
const fail = (res, err, what) => {
  if (err instanceof svc.TxError) return res.status(err.status).json({ success: false, code: err.code, message: err.message });
  console.error(`[student-transactions] ${what}:`, err && err.message);
  return res.status(500).json({ success: false, code: 'SERVER_ERROR', message: what === 'receipt'
    ? "We couldn't generate your receipt right now. Your verified payment remains recorded. Please try again."
    : 'Could not load your transactions right now. Please try again.' });
};
const noStore = (res) => res.set('Cache-Control', 'no-store');

const sendPdf = (res, buf, filename, extra = {}) => {
  const safe = String(filename).replace(/[^A-Za-z0-9._-]/g, '_');
  res.set({
    'Content-Type': 'application/pdf', 'Content-Length': String(buf.length), 'Content-Disposition': `attachment; filename="${safe}"`,
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', ...extra,
  });
  res.send(buf);
};

const list = async (req, res) => { try { noStore(res); res.json({ success: true, ...(await svc.list(req.user, req.query)) }); } catch (e) { fail(res, e, 'list'); } };
const detail = async (req, res) => { try { noStore(res); res.json({ success: true, transaction: await svc.detail(req.user, req.params.id) }); } catch (e) { fail(res, e, 'detail'); } };
const receipt = async (req, res) => {
  try { const { data, filename } = await svc.receiptFile(req.user, req.params.id); sendPdf(res, await pdf.receiptsPdf([data]), filename); } catch (e) { fail(res, e, 'receipt'); }
};
const statement = async (req, res) => {
  try { const { data, filename } = await svc.statementFile(req.user, req.params.id); sendPdf(res, await pdf.statementPdf(data), filename); } catch (e) { fail(res, e, 'receipt'); }
};
const bulk = async (req, res) => {
  try {
    const r = await svc.bulkReceipts(req.user, req.body && req.body.ids);
    sendPdf(res, await pdf.receiptsPdf(r.receipts), r.filename, { 'X-Receipts-Included': String(r.included), 'X-Receipts-Excluded': String(r.excluded), 'Access-Control-Expose-Headers': 'X-Receipts-Included, X-Receipts-Excluded, Content-Disposition' });
  } catch (e) { fail(res, e, 'receipt'); }
};

module.exports = { list, detail, receipt, statement, bulk };
