/**
 * The ONE place the Monthly Subscription is priced. Everything is in paise and lives on the server: the browser never sends,
 * and the server never trusts, an amount.
 */
const PLAN = Object.freeze({
  code: 'monthly',
  name: 'Monthly Subscription',
  mrpPaise: 12000,        // Rs 120
  amountPaise: 9900,      // Rs 99
  currency: 'INR',
  validityDays: 30,
  features: Object.freeze([
    'Unlimited exams for 30 days',
    'Unlimited interviews',
    'All Olympiad & practice tests of your standard',
  ]),
});

const discountPaise = () => PLAN.mrpPaise - PLAN.amountPaise;
const discountPercent = () => Math.floor((discountPaise() / PLAN.mrpPaise) * 100); // 17 (17.5 is shown as the advertised 17% OFF)

/** Public view for GET /api/subscriptions/plans (rupee values for display, paise for exactness). */
const publicPlan = () => ({
  code: PLAN.code, name: PLAN.name, currency: PLAN.currency, validityDays: PLAN.validityDays,
  mrpPaise: PLAN.mrpPaise, pricePaise: PLAN.amountPaise, discountPaise: discountPaise(), discountPercent: discountPercent(),
  mrp: PLAN.mrpPaise / 100, price: PLAN.amountPaise / 100, discount: discountPaise() / 100,
  features: [...PLAN.features],
});

module.exports = { PLAN, discountPaise, discountPercent, publicPlan };
