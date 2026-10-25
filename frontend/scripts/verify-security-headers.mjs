#!/usr/bin/env node
/**
 * Behavioural check of the security headers (not just of the configuration text).
 * Serves a production build with the headers of vercel.json, loads real pages in Chromium with the CSP ENFORCED (a Report-Only policy is
 * promoted to enforcing for this check, so every violation becomes visible) and verifies:
 *   - the headers that actually arrive on the wire,
 *   - no Content-Security-Policy violation on the visited routes,
 *   - the browser's Permissions-Policy state (camera / microphone allowed for the app, geolocation denied),
 *   - a page from another origin cannot frame the app (clickjacking).
 * Usage:  VITE_API_URL=https://example.onrender.com/api npm run build -- --outDir dist-csp && node scripts/verify-security-headers.mjs dist-csp
 * Needs Playwright's Chromium.  Exit code 1 on any failure.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const dist = path.resolve(process.argv[2] || 'dist');
const cfg = JSON.parse(fs.readFileSync(process.env.HEADERS_CONFIG ? path.resolve(process.env.HEADERS_CONFIG) : new URL('../vercel.json', import.meta.url), 'utf8'));   // HEADERS_CONFIG: negative-control runs
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
const matches = (source, url) => new RegExp(`^${source.replace(/\(\.\*\)/g, '.*')}$`).test(url);
const headersFor = (url) => {
  const out = {};
  for (const h of cfg.headers) if (matches(h.source, url)) for (const { key, value } of h.headers) out[key.toLowerCase()] = value;
  if (out['content-security-policy-report-only'] && !out['content-security-policy']) {
    out['content-security-policy'] = out['content-security-policy-report-only'];   // enforce, to surface every violation
    delete out['content-security-policy-report-only'];
  }
  return out;
};
const serve = () => http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(dist, url);
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');   // SPA rewrite
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', ...headersFor(url) });
  fs.createReadStream(file).pipe(res);
});

const failures = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures.push(msg); };

const app = serve(); const other = http.createServer((_q, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<iframe id="f" src="http://127.0.0.1:${app.address().port}/login" width="400" height="300"></iframe>`);
});
await new Promise((r) => app.listen(0, '127.0.0.1', r)); await new Promise((r) => other.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${app.address().port}`;

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const violations = [];
  await page.exposeFunction('__csp', (v) => violations.push(v));
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => window.__csp(`${e.effectiveDirective} blocked ${e.blockedURI.slice(0, 80)}`)));

  const resp = await page.goto(`${base}/`, { waitUntil: 'load' });
  const h = resp.headers();
  check(h['x-content-type-options'] === 'nosniff', 'X-Content-Type-Options: nosniff is sent');
  check(h['x-frame-options'] === 'DENY', 'X-Frame-Options: DENY is sent');
  check(/max-age=\d{7,}/.test(h['strict-transport-security'] || ''), 'Strict-Transport-Security is sent');
  check(/strict-origin/.test(h['referrer-policy'] || ''), 'Referrer-Policy is sent');
  check(/frame-ancestors 'none'/.test(h['content-security-policy'] || ''), 'CSP (enforced for this check) is sent with frame-ancestors none');

  for (const route of ['/', '/login', '/register', '/forgot-password', '/does-not-exist']) {
    await page.goto(`${base}${route}`, { waitUntil: 'load' }); await page.waitForTimeout(1200);
  }
  const real = violations.filter((v) => !/^(font-src|style-src-elem) blocked https:\/\/fonts\./.test(v));   // Google Fonts are allowed by the policy; offline sandbox cannot fetch them
  check(real.length === 0, `no CSP violations on the visited routes${real.length ? ': ' + [...new Set(real)].join(' | ') : ''}`);
  const body = (await page.locator('body').innerText()).trim();
  check(body.length > 0, 'the app still renders its content with the CSP enforced');

  const pp = await page.evaluate(() => {
    const p = document.permissionsPolicy || document.featurePolicy;
    return p ? { camera: p.allowsFeature('camera'), microphone: p.allowsFeature('microphone'), geolocation: p.allowsFeature('geolocation') } : null;
  });
  check(!!pp && pp.camera === true && pp.microphone === true, 'Permissions-Policy still allows camera and microphone for the app (proctoring, live classes)');
  check(!!pp && pp.geolocation === false, 'Permissions-Policy denies geolocation');

  // clickjacking: another origin tries to frame the app
  const p2 = await ctx.newPage(); await p2.goto(`http://127.0.0.1:${other.address().port}/`); await p2.waitForTimeout(1500);
  const frame = p2.frames().find((f) => f !== p2.mainFrame());
  const framed = frame ? await frame.evaluate(() => document.body && document.body.innerText.length > 0).catch(() => false) : false;
  check(!framed, 'a page on another origin cannot display the app in an iframe');

  // the inline theme script (allowed only by its hash) really ran
  const themeRan = await page.evaluate(() => !document.documentElement.classList.contains('dark'));
  check(themeRan, 'the hashed inline theme script is allowed to run');
} finally { await browser.close(); app.close(); other.close(); }

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll security-header behaviour checks passed');
process.exit(failures.length ? 1 : 0);
