#!/usr/bin/env node
/**
 * Fails when confidential material is tracked by Git:
 *   - question papers WITH answer keys (the removed backend/src/data/oct24/ files and anything shaped like them),
 *   - private keys / keystores / .env files / database dumps.
 * Question banks belong in the database (imported privately - see docs/EXAM_DATA_SECURITY.md), never in this public repository.
 * Prints file names only, never file contents.     Usage: node scripts/check-no-confidential-data.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 1 << 26 }).toString('utf8').split('\0').filter(Boolean);

const BAD_PATH = [
  [/(^|\/)data\/oct24(\/|$)/i, 'removed Oct-24 paper directory'],
  [/(^|\/)std(10|[1-9])\.json$/i, 'per-standard paper file (stdN.json)'],
  [/(^|\/)\.env(\..+)?$/i, 'environment file (only .env.example is allowed)'],
  [/\.(pem|key|p12|pfx|jks|keystore)$/i, 'private key / keystore'],
  [/\.(sql|dump|bak)$/i, 'database dump / backup'],
  [/\.(apk|aab)$/i, 'Android release artifact'],
];
const ALLOWED_PATH = [/(^|\/)\.env\.example$/i];
// files where fake questions/answers legitimately live (test fixtures)
const FIXTURE_DIRS = [/^backend\/src\/tests\//, /^frontend\/e2e\//, /^frontend\/tests-unit\//];
// Question banks that were ALREADY public before this check existed. They are used by seed scripts / the admin "seed" action, so they were not
// removed automatically. Listed explicitly (not by pattern) so that anything NEW is still blocked; the owner decides whether to retire them
// (see docs/EXAM_DATA_SECURITY.md). Do not add new entries without that decision.
const KNOWN_EXISTING_BANKS = new Set([
  'backend/src/data/engineeringQuestions.js', 'backend/src/seed/seedData.js',
  ...Array.from({ length: 10 }, (_, i) => `backend/src/data/olympiad${i + 1}Questions.js`),
]);
const KEY_RE = /["']?(answer|correctAnswer|correct_answer)["']?\s*:/g;
const OPTS_RE = /["']?options["']?\s*:\s*\[/g;
const MAX_BYTES = 5 * 1024 * 1024;
const MIN_QUESTIONS = 8; // a handful of fake questions in a doc is fine; a question BANK is not

const problems = [];
for (const f of files) {
  if (!ALLOWED_PATH.some((r) => r.test(f))) for (const [r, why] of BAD_PATH) if (r.test(f)) problems.push(`${f}: ${why}`);
  if (FIXTURE_DIRS.some((r) => r.test(f)) || !/\.(json|js|ts|tsx|md|csv|txt)$/i.test(f)) continue;
  let text; try { const st = fs.statSync(path.join(root, f)); if (st.size > MAX_BYTES) continue; text = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
  const keys = (text.match(KEY_RE) || []).length; const opts = (text.match(OPTS_RE) || []).length;
  if (keys >= MIN_QUESTIONS && opts >= MIN_QUESTIONS && !KNOWN_EXISTING_BANKS.has(f)) problems.push(`${f}: looks like a question bank with answer keys (${opts} option lists, ${keys} answer fields)`);
}

if (problems.length) {
  console.error('Confidential data must not be committed to this public repository:\n  ' + [...new Set(problems)].join('\n  '));
  process.exit(1);
}
console.log(`OK: ${files.length} tracked files checked - no question banks with answer keys, keys, env files or dumps.`);
