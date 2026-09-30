const crypto = require('crypto');
const Razorpay = require('razorpay');

/**
 * The ONE place the backend talks to Razorpay (course/lecture payments and the Olympiad fee).
 *
 * Credentials come only from the server environment (backend/.env locally, Render env vars in production):
 *   RAZORPAY_KEY_ID      public key id (rzp_test_… / rzp_live_…) — also sent to the browser to open Checkout
 *   RAZORPAY_KEY_SECRET  private — used here for the API client and signature checks, NEVER sent to the browser
 */
const PLACEHOLDER_PREFIX = 'rzp_test_YOUR'; // old .env.example placeholder value

/**
 * Test/live separation. Production must never run on TEST keys: a "payment" made with rzp_test_* moves no real money,
 * yet would unlock paid content. Outside production (local development) TEST keys are expected and always allowed.
 * ALLOW_TEST_PAYMENTS_IN_PRODUCTION=true is an explicit, deliberate escape hatch for a staging deployment.
 * Returns a human-readable problem (never a key value) or null.
 */
const keyModeProblem = (env = process.env) => {
  if (env.NODE_ENV !== 'production') return null;
  const id = env.RAZORPAY_KEY_ID || '';
  if (id.startsWith('rzp_test_') && !id.startsWith(PLACEHOLDER_PREFIX) && env.ALLOW_TEST_PAYMENTS_IN_PRODUCTION !== 'true') {
    return 'RAZORPAY_KEY_ID is a TEST key (rzp_test_…) but this is a production deployment, which requires LIVE keys (rzp_live_…)';
  }
  return null;
};

const isRazorpayConfigured = () => {
  const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = process.env;
  return Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET && !RAZORPAY_KEY_ID.startsWith(PLACEHOLDER_PREFIX)) && !keyModeProblem();
};

/** Razorpay API client, or null when the keys are not configured. */
const getRazorpayInstance = () => {
  if (!isRazorpayConfigured()) return null;
  return new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
};

/** Public key id the browser needs to open Checkout for an order this server created. */
const getRazorpayKeyId = () => process.env.RAZORPAY_KEY_ID;

/**
 * Checkout signature check: HMAC-SHA256(order_id + "|" + payment_id, RAZORPAY_KEY_SECRET),
 * compared in constant time. Returns false (never throws) for missing / malformed input.
 */
const isValidPaymentSignature = ({ orderId, paymentId, signature }) => {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret || typeof orderId !== 'string' || typeof paymentId !== 'string' || typeof signature !== 'string') return false;
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex'));
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
};

/** Non-secret status for logs / health checks: whether keys are set and which mode they are. */
const getRazorpayStatus = () => {
  const keyId = process.env.RAZORPAY_KEY_ID || '';
  const mode = keyId.startsWith('rzp_live_') ? 'live' : keyId.startsWith('rzp_test_') ? 'test' : 'unknown';
  const problem = keyModeProblem();
  return { configured: isRazorpayConfigured(), mode: isRazorpayConfigured() ? mode : null, ...(problem ? { blocked: true } : {}) };
};

module.exports = {
  getRazorpayInstance, getRazorpayKeyId, isRazorpayConfigured, isValidPaymentSignature, getRazorpayStatus, keyModeProblem,
};
