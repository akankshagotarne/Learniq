// Fail fast in production when the login-token secret is missing or obviously a placeholder.
// Never prints the secret itself. Local development only gets warnings so it keeps working.
const PLACEHOLDER = /(^|[^a-z])(your|change|changeme|replace|example|placeholder|default|dummy|sample|secret[_-]?here|test|dev(elopment)?)([^a-z]|$)/i;
const COMMON = new Set(['secret', 'jwtsecret', 'jwt_secret', 'password', 'learniq', '12345678', '123456789012345678']);

const problemWith = (name, value) => {
  if (!value) return `${name} is not set`;
  if (COMMON.has(String(value).toLowerCase()) || PLACEHOLDER.test(value)) return `${name} looks like a placeholder/default value`;
  if (String(value).length < 16) return `${name} is too short (${String(value).length} characters)`;
  return null;
};

/** Production e-mail configuration problems (names only - values are never printed). */
const VERIFIED_SENDING_DOMAIN = 'send.learniq.study';
const emailProblems = (env) => {
  const out = [];
  const { providerFor, domainOf } = require('../services/mailer');
  const provider = providerFor(env);
  if (!provider) return ['No email provider (RESEND_API_KEY + EMAIL_FROM, or EMAIL_USER/EMAIL_PASS) — password reset emails cannot be sent'];
  const sender = String(env.EMAIL_FROM || (provider === 'resend' ? env.RESEND_FROM_EMAIL : '') || '').trim();
  if (provider === 'resend') {
    if (env.EMAIL_USER && env.EMAIL_PASS) out.push('Both RESEND_API_KEY and EMAIL_USER/EMAIL_PASS are set — Resend is used and the SMTP settings are ignored');
    if (!sender) out.push(`RESEND_API_KEY is set but EMAIL_FROM is missing — no email will be sent in production (use an address on ${VERIFIED_SENDING_DOMAIN})`);
    else {
      const domain = domainOf(sender);
      const allowed = String(env.EMAIL_SENDING_DOMAIN || VERIFIED_SENDING_DOMAIN).toLowerCase();
      if (domain === 'resend.dev') out.push('EMAIL_FROM uses the Resend sandbox domain — it can only deliver to the Resend account owner and is refused in production');
      else if (!domain || (domain !== allowed && !domain.endsWith(`.${allowed}`))) out.push(`EMAIL_FROM is not an address on the verified sending domain ${allowed} — Resend will reject it unless that domain is verified`);
    }
  }
  return out;
};

const validateEnv = (env = process.env, log = console) => {
  const isProd = env.NODE_ENV === 'production';
  const fatal = [];
  const warn = [];

  const jwtProblem = problemWith('JWT_SECRET', env.JWT_SECRET);
  if (jwtProblem) (isProd ? fatal : warn).push(jwtProblem);
  else if (String(env.JWT_SECRET).length < 32) warn.push('JWT_SECRET is shorter than 32 characters — use a longer random value');

  // Test/live separation: production must not boot on rzp_test_* keys; local development should not use rzp_live_* keys.
  const { keyModeProblem } = require('../services/razorpayClient');
  const keyProblem = keyModeProblem(env);
  if (keyProblem) fatal.push(keyProblem);
  else if (!isProd && String(env.RAZORPAY_KEY_ID || '').startsWith('rzp_live_')) {
    warn.push('RAZORPAY_KEY_ID is a LIVE key (rzp_live_…) outside production — use TEST keys (rzp_test_…) for local development so no real money is charged');
  }

  if (isProd) {
    if (!env.CLIENT_URL) warn.push('CLIENT_URL is not set — browser requests from your frontend will be blocked by CORS and reset links will point to localhost');
    warn.push(...emailProblems(env));
  } else if (env.NODE_ENV === undefined) {
    warn.push('NODE_ENV is not set — set NODE_ENV=production on your live server');
  }

  warn.forEach((w) => log.warn(`⚠️  [env] ${w}`));
  if (fatal.length) {
    fatal.forEach((f) => log.error(`❌ [env] ${f}. Set a long random value, e.g.  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`));
    return { ok: false, fatal, warn };
  }
  return { ok: true, fatal, warn };
};

module.exports = { validateEnv, problemWith, emailProblems };
