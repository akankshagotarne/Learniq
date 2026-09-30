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

const validateEnv = (env = process.env, log = console) => {
  const isProd = env.NODE_ENV === 'production';
  const fatal = [];
  const warn = [];

  const jwtProblem = problemWith('JWT_SECRET', env.JWT_SECRET);
  if (jwtProblem) (isProd ? fatal : warn).push(jwtProblem);
  else if (String(env.JWT_SECRET).length < 32) warn.push('JWT_SECRET is shorter than 32 characters — use a longer random value');

  if (isProd) {
    if (!env.CLIENT_URL) warn.push('CLIENT_URL is not set — browser requests from your frontend will be blocked by CORS and reset links will point to localhost');
    if (!env.EMAIL_USER && !env.RESEND_API_KEY) warn.push('No email provider (EMAIL_USER/EMAIL_PASS or RESEND_API_KEY) — password reset emails cannot be sent');
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

module.exports = { validateEnv, problemWith };
