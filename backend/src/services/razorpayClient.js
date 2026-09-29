const Razorpay = require('razorpay');

/**
 * Shared Razorpay client factory (same environment variables and "not configured"
 * behaviour as controllers/paymentController.js). Secrets stay on the server.
 */
const getRazorpayInstance = () => {
  const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = process.env;
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET || RAZORPAY_KEY_ID.startsWith('rzp_test_YOUR')) {
    return null;
  }
  return new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });
};

module.exports = { getRazorpayInstance };
