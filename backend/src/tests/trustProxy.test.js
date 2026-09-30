/**
 * Regression: Render's reverse proxy vs express-rate-limit (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR).
 * Real Express + real express-rate-limit over a real socket; no database, no network beyond 127.0.0.1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { getTrustProxySetting, parseHops } = require('../config/trustProxy');

const PROD = { NODE_ENV: 'production' };
const RENDER_ONLY = { RENDER: 'true' };

// --- helpers -----------------------------------------------------------------
// Starts an app shaped like server.js (trust proxy first, then a limiter on /api) and returns helpers.
const startApp = async ({ env, max = 3 }) => {
  const app = express();
  const setting = getTrustProxySetting(env);
  app.set('trust proxy', setting);
  app.use('/api', rateLimit({ windowMs: 60_000, max, message: { success: false, message: 'Too many requests.' } }));
  app.get('/api/ip', (req, res) => res.json({ ip: req.ip, ips: req.ips }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const get = (headers = {}) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/api/ip', headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }));
    }).on('error', reject);
  });
  return { setting, get, close: () => new Promise((r) => server.close(r)) };
};

// Captures what express-rate-limit logs (it reports configuration problems through console.error).
const captureLogs = async (fn) => {
  const original = console.error;
  const lines = [];
  console.error = (...args) => { lines.push(args.map((a) => (a && a.message) || (a && a.code) || String(a)).join(' ')); };
  try { await fn(); } finally { console.error = original; }
  return lines.join('\n');
};

// --- setting selection ---------------------------------------------------------
test('production and Render get exactly 1 proxy hop; never the boolean true', () => {
  assert.equal(getTrustProxySetting(PROD), 1);
  assert.equal(getTrustProxySetting(RENDER_ONLY), 1);
  assert.equal(getTrustProxySetting({ NODE_ENV: 'production', RENDER: 'true' }), 1);
  for (const env of [PROD, RENDER_ONLY, {}, { NODE_ENV: 'development' }, { TRUST_PROXY_HOPS: 'true' }, { NODE_ENV: 'production', TRUST_PROXY_HOPS: 'true' }]) {
    assert.notEqual(getTrustProxySetting(env), true);
    assert.ok(getTrustProxySetting(env) === false || Number.isInteger(getTrustProxySetting(env)));
  }
});

test('local development keeps Express default (false): nothing trusted, nothing changes', () => {
  assert.equal(getTrustProxySetting({}), false);
  assert.equal(getTrustProxySetting({ NODE_ENV: 'development' }), false);
  assert.equal(getTrustProxySetting({ NODE_ENV: 'test' }), false);
});

test('TRUST_PROXY_HOPS overrides the hop count only with a whole number from 1 to 5', () => {
  assert.equal(getTrustProxySetting({ ...PROD, TRUST_PROXY_HOPS: '2' }), 2);
  assert.equal(getTrustProxySetting({ ...PROD, TRUST_PROXY_HOPS: ' 3 ' }), 3);
  assert.equal(getTrustProxySetting({ ...PROD, TRUST_PROXY_HOPS: '5' }), 5);
  for (const bad of ['true', 'false', '0', '-1', '6', '99', '1.5', 'abc', '', '1,2', '10.0.0.0/8', 'loopback']) {
    assert.equal(parseHops(bad), null, `"${bad}" must be ignored`);
    assert.equal(getTrustProxySetting({ ...PROD, TRUST_PROXY_HOPS: bad }), 1, `"${bad}" must fall back to the safe default in production`);
    assert.equal(getTrustProxySetting({ TRUST_PROXY_HOPS: bad }), false, `"${bad}" must fall back to false in development`);
  }
});

// --- behaviour against the real libraries ---------------------------------------------
test('BUG REPRODUCED: without trust proxy, express-rate-limit logs ERR_ERL_UNEXPECTED_X_FORWARDED_FOR', async () => {
  const app = await startApp({ env: {} }); // development setting == the old production behaviour (trust proxy false)
  try {
    const logs = await captureLogs(async () => { await app.get({ 'x-forwarded-for': '203.0.113.7' }); });
    assert.match(logs, /ERR_ERL_UNEXPECTED_X_FORWARDED_FOR|X-Forwarded-For/);
  } finally { await app.close(); }
});

test('FIX: production setting removes the error and req.ip is the client address from X-Forwarded-For', async () => {
  const app = await startApp({ env: PROD });
  try {
    assert.equal(app.setting, 1);
    const logs = await captureLogs(async () => {
      const r = await app.get({ 'x-forwarded-for': '203.0.113.7' });
      assert.equal(r.status, 200);
      assert.equal(r.body.ip, '203.0.113.7');
    });
    assert.doesNotMatch(logs, /ERR_ERL_UNEXPECTED_X_FORWARDED_FOR/);
    assert.doesNotMatch(logs, /trust proxy/i);
    assert.equal(logs.trim(), '', 'express-rate-limit must log nothing at all');
  } finally { await app.close(); }
});

test('SECURITY: a client that forges X-Forwarded-For cannot choose its own IP (only the proxy-written entry counts)', async () => {
  const app = await startApp({ env: PROD });
  try {
    // A client sends "6.6.6.6"; Render's proxy appends the real client address "203.0.113.7".
    const r = await app.get({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7' });
    assert.equal(r.body.ip, '203.0.113.7');
    const r2 = await app.get({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 203.0.113.7' });
    assert.equal(r2.body.ip, '203.0.113.7');
  } finally { await app.close(); }
});

test('rate limiting still works: same client is limited after max requests, other clients are not', async () => {
  const app = await startApp({ env: PROD, max: 3 });
  try {
    const a = { 'x-forwarded-for': '203.0.113.7' };
    const b = { 'x-forwarded-for': '198.51.100.9' };
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await app.get(a)).status);
    assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
    assert.equal((await app.get(b)).status, 200, 'a different client has its own bucket');
    // forging a fresh IP in front of the real one must NOT reset the limit
    assert.equal((await app.get({ 'x-forwarded-for': '9.9.9.9, 203.0.113.7' })).status, 429);
  } finally { await app.close(); }
});

test('local development: no proxy trusted, requests without X-Forwarded-For work, no logs, X-Forwarded-For cannot be spoofed', async () => {
  const app = await startApp({ env: { NODE_ENV: 'development' }, max: 3 });
  try {
    assert.equal(app.setting, false);
    const logs = await captureLogs(async () => {
      const r = await app.get();
      assert.equal(r.status, 200);
      assert.match(r.body.ip, /127\.0\.0\.1$/);
    });
    assert.equal(logs.trim(), '', 'plain localhost requests (no X-Forwarded-For) log nothing');
    // spoofing is useless in dev too: the header is ignored, the socket address is used
    const spoof = await app.get({ 'x-forwarded-for': '6.6.6.6' });
    assert.match(spoof.body.ip, /127\.0\.0\.1$/);
  } finally { await app.close(); }
});

// --- wiring in server.js ----------------------------------------------------------------
test('server.js applies the setting before any rate limiter, never uses trust proxy true, and keeps validation on', () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(src, /app\.set\('trust proxy', getTrustProxySetting\(\)\)/);
  assert.doesNotMatch(src, /trust proxy['"],\s*true/);
  assert.ok(src.indexOf("app.set('trust proxy'") < src.indexOf('rateLimit({'), 'trust proxy must be configured before the limiter is created');
  assert.ok(src.indexOf("app.set('trust proxy'") < src.indexOf("app.use('/api', limiter)"));
  for (const f of ['server.js', '../routes/olympiad.js', '../routes/certificates.js', '../services/mediaAccess.js']) {
    const s = fs.readFileSync(path.join(__dirname, '..', f.startsWith('..') ? f.slice(3) : f), 'utf8');
    assert.doesNotMatch(s, /validate\s*:\s*(false|\{[^}]*(xForwardedForHeader|trustProxy|default)\s*:\s*false)/, `${f} must not switch off express-rate-limit validation`);
  }
});
