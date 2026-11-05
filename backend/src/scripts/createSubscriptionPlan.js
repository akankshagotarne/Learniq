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
  const mode = String(process.env.RAZORPAY_KEY_ID || '').startsWith('rzp_live_') ? 'LIVE' : 'TEST';
  console.log(`Razorpay mode for these keys: ${mode}`);
  // never create a duplicate: reuse an existing plan of the agreed shape (daily x 30, Rs 99, INR) in THIS account
  try {
    const existing = await rzp.plans.all({ count: 100 });
    const same = ((existing && existing.items) || []).find((p) => p.period === 'daily' && Number(p.interval) === 30 && p.item && p.item.amount === PLAN.amountPaise && p.item.currency === PLAN.currency && p.item.name === 'LearnIQ Monthly Subscription');
    if (same) { console.log(`A matching ${mode} plan already exists: ${same.id}\nAdd this to the backend environment:  RAZORPAY_MONTHLY_PLAN_ID=${same.id}\nNothing created.`); return; }
  } catch (err) {
    const d = err && err.error && err.error.description;
    console.error(`Could not list existing plans: ${d || err.message || err}`);
    if (/not.*(enabled|activated)|access denied/i.test(String(d || ''))) console.error('The Subscriptions feature looks disabled on this Razorpay account: enable it in the Razorpay Dashboard (Subscriptions), then run this again.');
    process.exit(1);
  }
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
