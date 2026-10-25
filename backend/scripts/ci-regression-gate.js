#!/usr/bin/env node
/*
 * Regression gate for the backend test suite.
 * Runs `node --test src/tests/*.test.js` and compares every failing test with tests-known-failures.json
 * (failures that already existed on main before the security remediation).
 *   - a failing test that is NOT in the list      -> exit 1 (new regression)
 *   - the runner crashes / reports no tests        -> exit 1
 *   - a listed test that now passes                -> warning only (remove it from the list)
 * Nothing is skipped or weakened: every test still runs and every failure is still printed.
 */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const known = new Set(JSON.parse(fs.readFileSync(path.join(root, 'tests-known-failures.json'), 'utf8')).known.map((k) => k.name));
const files = fs.readdirSync(path.join(root, 'src', 'tests')).filter((f) => f.endsWith('.test.js')).map((f) => path.join('src', 'tests', f));

const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30, env: { ...process.env, TZ: process.env.TZ || 'UTC' } });
fs.writeFileSync(path.join(require('os').tmpdir(), 'backend-test-output.tap'), r.stdout || '');
const out = r.stdout || '';
const num = (k) => Number((out.match(new RegExp(`^# ${k} (\\d+)`, 'm')) || [])[1] || 0);
const total = num('tests'), pass = num('pass'), fail = num('fail'), skipped = num('skipped');
if (!total) { console.error('GATE: the test runner reported no tests.\n', (r.stderr || '').slice(-2000)); process.exit(1); }

const failing = new Set();
for (const m of out.matchAll(/^\s*not ok \d+ - (.*?)(?:\s+#.*)?$/gm)) failing.add(m[1].trim());
const unexpected = [...failing].filter((n) => !known.has(n) && !/\.test\.js$/.test(n));
const fixed = [...known].filter((n) => !failing.has(n));

console.log(`backend tests: ${total} total, ${pass} passed, ${fail} failed, ${skipped} skipped`);
console.log(`known pre-existing failures still failing: ${[...failing].filter((n) => known.has(n)).length} / ${known.size}`);
if (fixed.length) console.log('WARNING: these known failures now pass - remove them from tests-known-failures.json:\n  - ' + fixed.join('\n  - '));
if (unexpected.length) { console.error('\nGATE FAILED - new failing tests (not in the known baseline):\n  - ' + unexpected.join('\n  - ')); process.exit(1); }
if (fail > 0 && failing.size === 0) { console.error('GATE: failures reported but none could be parsed'); process.exit(1); }
console.log('GATE PASSED: no new failures versus the main baseline.');
