/**
 * ONE-TIME script: creates the Razorpay Plan used by Monthly Subscription auto-renew, then prints its id.
 *   node src/scripts/createSubscriptionPlan.js
 * Put the printed id in the RAZORPAY_MONTHLY_PLAN_ID environment variable (Render). Never run this per request.
 *
 * period "daily" + interval 30 on purpose: Razorpay's "monthly" is a CALENDAR month, but the plan is valid for exactly 30 days.
 * Needs RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in the environment (backend/.env or exported). Prints no secret.
 */
require('dotenv').config();
const { getRazorpayInstance } = require('../services/razorpayClient');
const { PLAN } = require('../config/subscriptionPlan');

(async () => {
  if (process.env.RAZORPAY_MONTHLY_PLAN_ID) {
    console.log(`RAZORPAY_MONTHLY_PLAN_ID is already set (${process.env.RAZORPAY_MONTHLY_PLAN_ID}). Nothing created.`);
    return;
  }
  const rzp = getRazorpayInstance();
  if (!rzp) { console.error('Razorpay is not configured: set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.'); process.exit(1); }
  try {
    const plan = await rzp.plans.create({
      period: 'daily', interval: 30,
      item: { name: 'LearnIQ Monthly Subscription', amount: PLAN.amountPaise, currency: PLAN.currency, description: 'Unlimited exams & interviews for one standard, every 30 days' },
      notes: { product: 'learniq-monthly-subscription' },
    });
    console.log(`Created Razorpay plan: ${plan.id}\nAdd this to the backend environment:  RAZORPAY_MONTHLY_PLAN_ID=${plan.id}`);
  } catch (err) {
    const d = err && err.error && err.error.description;
    console.error(`Could not create the plan: ${d || err.message || err}`);
    if (/not.*(enabled|activated)|access denied/i.test(String(d || ''))) console.error('The Subscriptions feature looks disabled on this Razorpay account: enable it in the Razorpay Dashboard (Subscriptions), then run this again.');
    process.exit(1);
  }
})();
