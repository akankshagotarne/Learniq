const svc = require('../services/subscriptionService');

/** Student-only (role is enforced on the route). The student is ALWAYS req.user: never read from the URL, query or body. */
const fail = (res, err, what) => {
  if (err instanceof svc.SubscriptionError) return res.status(err.status).json({ success: false, code: err.code, message: err.message });
  console.error(`[subscription] ${what}:`, err && err.message);
  return res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' });
};
const noStore = (res) => res.set('Cache-Control', 'no-store');

const plans = (req, res) => { res.json({ success: true, plan: require('../config/subscriptionPlan').publicPlan(), autopayAvailable: !!process.env.RAZORPAY_MONTHLY_PLAN_ID }); };
const me = async (req, res) => { try { noStore(res); res.json({ success: true, ...(await svc.summary(req.user._id)) }); } catch (e) { fail(res, e, 'me'); } };
const order = async (req, res) => { try { noStore(res); res.json({ success: true, ...(await svc.createOrder(req.user, req.body)) }); } catch (e) { fail(res, e, 'order'); } };
const verify = async (req, res) => { try { noStore(res); res.json({ success: true, ...(await svc.verify(req.user, req.body)) }); } catch (e) { fail(res, e, 'verify'); } };
const autoRenew = async (req, res) => {
  try { noStore(res); res.json({ success: true, ...(await svc.setAutoRenew(req.user, req.params.id, req.body && req.body.enabled)) }); } catch (e) { fail(res, e, 'auto-renew'); }
};
const invoice = async (req, res) => {
  try {
    const data = await svc.invoiceData(req.user, req.params.id);
    const buf = await require('../services/receiptPdf').invoicePdf(data);
    res.set({
      'Content-Type': 'application/pdf', 'Content-Length': String(buf.length), 'Content-Disposition': `attachment; filename="LearnIQ_Invoice_${data.invoiceNumber}.pdf"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    });
    res.send(buf);
  } catch (e) { fail(res, e, 'invoice'); }
};

module.exports = { plans, me, order, verify, autoRenew, invoice };
