const razorpayClient = require('./razorpayClient');

/** Razorpay method codes the application understands. Anything else is stored as-is but shown generically. */
const KNOWN = { upi: 'UPI', card: 'Card', netbanking: 'Net Banking', wallet: 'Wallet', emi: 'EMI', paylater: 'Pay Later' };
const methodLabel = (m) => (m && KNOWN[m] ? `${KNOWN[m]} via Razorpay` : 'Razorpay');
const methodShort = (m) => (m && KNOWN[m] ? KNOWN[m] : 'Razorpay');

/**
 * Reads the payment method from Razorpay for a VERIFIED payment and stores it on the record (best effort, never throws).
 * The method is only ever taken from the gateway response - never guessed and never from the browser.
 */
const captureMethod = async (OlympiadPayment, payment) => {
  try {
    if (!payment || payment.method || !payment.razorpayPaymentId || payment.status !== 'SUCCESS') return payment && payment.method;
    const rzp = razorpayClient.getRazorpayInstance();
    if (!rzp || !rzp.payments || typeof rzp.payments.fetch !== 'function') return null;
    const remote = await rzp.payments.fetch(payment.razorpayPaymentId);
    const m = remote && typeof remote.method === 'string' ? remote.method.toLowerCase().slice(0, 20) : null;
    if (!m) return null;
    await OlympiadPayment.updateOne({ _id: payment._id, method: { $in: [null, undefined] } }, { $set: { method: m } });
    payment.method = m;
    return m;
  } catch (err) {
    console.warn('[payments] could not read the payment method:', err && err.message);
    return null;
  }
};

module.exports = { KNOWN, methodLabel, methodShort, captureMethod };
