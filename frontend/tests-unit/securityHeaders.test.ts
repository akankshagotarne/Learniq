import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const all = (cfg.headers as { source: string; headers: { key: string; value: string }[] }[]).find((h) => h.source === '/(.*)');
const get = (k: string) => all?.headers.find((h) => h.key === k)?.value ?? '';

test('baseline security headers are served on every route', () => {
  assert.ok(all, 'a /(.*) header rule exists');
  assert.equal(get('X-Content-Type-Options'), 'nosniff');
  assert.equal(get('X-Frame-Options'), 'DENY');
  assert.match(get('Strict-Transport-Security'), /max-age=\d{7,}/);
  assert.match(get('Referrer-Policy'), /strict-origin/);
  assert.match(get('Permissions-Policy'), /camera=\(self\)/);   // proctoring and live classes need camera/microphone
  assert.match(get('Permissions-Policy'), /microphone=\(self\)/);
});

test('the CSP forbids the dangerous things and keeps what the app needs', () => {
  const csp = get('Content-Security-Policy-Report-Only') || get('Content-Security-Policy');
  assert.ok(csp, 'a CSP is present');
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /base-uri 'self'/);
  const script = /script-src ([^;]*)/.exec(csp)?.[1] ?? '';
  assert.ok(!script.includes("'unsafe-eval'"), 'no unsafe-eval');
  assert.ok(!script.includes("'unsafe-inline'"), 'no unsafe-inline for scripts');
  assert.ok(script.includes('https://checkout.razorpay.com'), 'payments keep working');
});

test('the CSP hash matches the inline script in index.html', () => {
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.trim());
  const csp = get('Content-Security-Policy-Report-Only') || get('Content-Security-Policy');
  for (const body of inline) {
    const h = `'sha256-${createHash('sha256').update(body).digest('base64')}'`;
    assert.ok(csp.includes(h), `inline script hash ${h} must be allowed by the CSP`);
  }
});
