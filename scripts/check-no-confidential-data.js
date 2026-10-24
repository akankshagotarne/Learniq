#!/usr/bin/env node
/**
 * Fails when confidential material is tracked by Git:
 *   - question papers / banks WITH answer keys (any language shape: answer, correctAnswer, correctOption, answerKey, isCorrect ...),
 *   - exam papers kept as documents (.pdf/.docx/.xlsx/.csv ... with paper/question/answer/mcq/exam/olympiad in the name),
 *   - private keys / keystores / .env files / database dumps.
 * Question banks belong in a private folder on the server (OLYMPIAD_PAPER_DIR / OLYMPIAD_BANK_DIR) or the database - never in this public repository.
 *
 * There is NO path allowlist. Two explicit, visible, in-file declarations are the only way for answer-shaped data to pass:
 *   - "SYNTHETIC TEST FIXTURE" (invented data) in the first 600 characters, only inside test fixture folders;
 *   - "PUBLIC DEMO CONTENT" (generic non-exam demo quizzes) in the first 600 characters, only under backend/src/seed/.
 * Every file that passes this way is listed in the output so a reviewer can see it. Prints file names only, never contents.
 * Usage: node scripts/check-no-confidential-data.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = process.env.CONFIDENTIAL_GUARD_ROOT ? path.resolve(process.env.CONFIDENTIAL_GUARD_ROOT) : path.join(__dirname, '..');
const listFiles = () => {
  if (process.env.CONFIDENTIAL_GUARD_FILES) return process.env.CONFIDENTIAL_GUARD_FILES.split('\n').filter(Boolean);   // used by the unit tests
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 1 << 26 }).toString('utf8').split('\0').filter(Boolean);
};
const files = listFiles();

const BAD_PATH = [
  [/(^|\/)data\/oct24(\/|$)/i, 'Oct-24 paper directory'],
  [/(^|\/)std(10|[1-9])\.json$/i, 'per-standard paper file (stdN.json)'],
  [/(^|\/)\.env(\..+)?$/i, 'environment file (only .env.example is allowed)'],
  [/\.(pem|key|p12|pfx|jks|keystore)$/i, 'private key / keystore'],
  [/\.(sql|dump|bak)$/i, 'database dump / backup'],
  [/\.(apk|aab)$/i, 'Android release artifact'],
  [/(paper|question|answer|mcq|exam|olympiad|quiz|mock)[^/]*\.(pdf|docx?|xlsx?|pptx?|csv|tsv)$/i, 'exam document (papers and answer keys must not be tracked)'],
];
const ALLOWED_PATH = [/(^|\/)\.env\.example$/i];
const FIXTURE_DIRS = [/^backend\/src\/tests\//, /^frontend\/e2e\//, /^frontend\/tests-unit\//];
const SEED_DIRS = [/^backend\/src\/seed\//];
const SYNTH = /SYNTHETIC TEST FIXTURE/;
const DEMO = /PUBLIC DEMO CONTENT/;
const KEY_RE = /["']?(answer|answers|correctAnswer|correct_answer|correctOption|correct_option|correctIndex|correctChoice|answerKey|answer_key|ansKey)["']?\s*[:=]/gi;
const FLAG_RE = /["']?isCorrect["']?\s*:\s*true/g;
const OPTS_RE = /["']?(options|choices)["']?\s*[:=]\s*\[/gi;
const MAX_BYTES = 5 * 1024 * 1024;
const MIN_QUESTIONS = 8; // a handful of invented questions inside a normal test is fine; a question BANK is not

const problems = []; const declared = [];
for (const f of files) {
  if (!ALLOWED_PATH.some((r) => r.test(f))) for (const [r, why] of BAD_PATH) if (r.test(f)) problems.push(`${f}: ${why}`);
  if (!/\.(json|js|ts|tsx|md|csv|txt)$/i.test(f)) continue;
  let text; try { const st = fs.statSync(path.join(root, f)); if (st.size > MAX_BYTES) continue; text = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
  const keys = (text.match(KEY_RE) || []).length + (text.match(FLAG_RE) || []).length; const opts = (text.match(OPTS_RE) || []).length;
  if (keys < MIN_QUESTIONS || opts < MIN_QUESTIONS) continue;
  const head = text.slice(0, 600);
  if (FIXTURE_DIRS.some((r) => r.test(f)) && SYNTH.test(head)) { declared.push(`${f} (synthetic test fixture)`); continue; }
  if (SEED_DIRS.some((r) => r.test(f)) && DEMO.test(head)) { declared.push(`${f} (declared public demo content)`); continue; }
  problems.push(`${f}: looks like a question bank with answer keys (${opts} option lists, ${keys} answer fields) and carries no valid declaration`);
}

if (declared.length) console.log(`Declared non-confidential answer-shaped files (review these):\n  ${declared.join('\n  ')}`);
if (problems.length) {
  console.error('Confidential data must not be committed to this public repository:\n  ' + [...new Set(problems)].join('\n  '));
  process.exit(1);
}
console.log(`OK: ${files.length} tracked files checked - no question banks with answer keys, exam documents, keys, env files or dumps.`);
