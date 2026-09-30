/**
 * Express "trust proxy" setting.
 *
 * Behind Render every request arrives through Render's reverse proxy, which adds an X-Forwarded-For header. With
 * Express's default (`trust proxy` = false) req.ip is the proxy's address and express-rate-limit rightly complains
 * (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR): every visitor would share one rate-limit bucket.
 *
 * Rules:
 *  - NEVER `true`. `true` trusts every entry in X-Forwarded-For, so a client could forge its own IP and dodge the limiter.
 *  - Trust an exact NUMBER of proxy hops instead. Express then reads the client address from the right-hand side of
 *    X-Forwarded-For, where only our own infrastructure writes, and ignores anything a client prepends.
 *  - Production / Render: 1 hop by default.
 *  - Local development: `false` (Express default). There is no proxy, so X-Forwarded-For is untrusted and unused.
 *  - TRUST_PROXY_HOPS (whole number 1-5) overrides the hop count without a code change, in case the platform's proxy chain
 *    is ever measured to be longer. Anything else (true, 0, -1, 99, "abc", "1.5") is ignored, never passed to Express.
 */
const DEFAULT_PRODUCTION_HOPS = 1;
const MAX_HOPS = 5;

const parseHops = (raw) => {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim();
  if (!/^\d{1,2}$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= MAX_HOPS ? n : null;
};

// Render sets RENDER=true on every service it runs; NODE_ENV=production is what a correctly configured deploy has.
const isProductionLike = (env) => env.NODE_ENV === 'production' || env.RENDER === 'true';

const getTrustProxySetting = (env = process.env) => {
  const configured = parseHops(env.TRUST_PROXY_HOPS);
  if (configured !== null) return configured;
  return isProductionLike(env) ? DEFAULT_PRODUCTION_HOPS : false;
};

module.exports = { getTrustProxySetting, parseHops, DEFAULT_PRODUCTION_HOPS, MAX_HOPS };
