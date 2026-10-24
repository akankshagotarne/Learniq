/**
 * Security hardening regression tests (no database, no network).   node --test src/tests/securityHardening.test.js
 *  - operator-supplied admin passwords: placeholders / short / repetitive values are refused
 *  - replacing an admin password ends every existing session of that account
 *  - the exam-paper importer needs a PRIVATE folder (nothing is read from the repository) and validates what it reads
 *  - answer keys are hidden by default in the question schema
 *  - nothing confidential is tracked by Git (scripts/check-no-confidential-data.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SRC = path.join(__dirname, '..');
const ROOT = path.join(SRC, '..', '..');

test('password policy refuses short, placeholder and repetitive admin passwords, accepts a strong one', () => {
  const { assessPassword } = require('../services/adminPasswordPolicy');
  for (const bad of ['short', 'your_admin_password', 'changeme-please-12', 'aaaaaaaaaaaaaa', 'MyPassword123456', 'Welcome12345678', undefined, null, 12345678901234])
    assert.ok(assessPassword(bad).length > 0, `should refuse ${String(bad).replace(/./g, '*')}`);
  assert.deepEqual(assessPassword('t7!Rk-Qm2#vLx9$Pw'), []);
});

test('createAdmin --set-password: refuses a placeholder password and changes nothing', async () => {
  const { run } = require('../scripts/createAdmin');
  let saved = 0; let ended = 0;
  const user = { _id: 'u1', role: 'admin', email: 'a@x.test', save: async () => { saved += 1; } };
  const User = { findOne: async () => user };
  const identity = { normalizeEmail: (e) => e, normalizePhone: () => ({ valid: false }) };
  const r = await run({ User, identity, setPassword: true, input: { email: 'a@x.test', password: 'your_new_password_here' }, log: () => {}, endSessions: async () => { ended += 1; } });
  assert.equal(r.status, 'INVALID'); assert.equal(saved, 0); assert.equal(ended, 0);
});

test('createAdmin --set-password: a good password is saved AND all existing sessions of the account are ended', async () => {
  const { run } = require('../scripts/createAdmin');
  const calls = [];
  const user = { _id: 'u1', role: 'admin', email: 'a@x.test', save: async () => { calls.push('save'); } };
  const User = { findOne: async () => user };
  const identity = { normalizeEmail: (e) => e, normalizePhone: () => ({ valid: false }) };
  const logs = [];
  const r = await run({ User, identity, setPassword: true, input: { email: 'a@x.test', password: 't7!Rk-Qm2#vLx9$Pw' }, log: (m) => logs.push(m), endSessions: async (id, why) => { calls.push(`end:${id}:${why}`); } });
  assert.equal(r.status, 'PASSWORD_REPLACED');
  assert.deepEqual(calls, ['save', 'end:u1:password_reset'], 'password saved first, then every session ended');
  assert.ok(!logs.join('\n').includes('t7!Rk'), 'the password is never logged');
});

test('exam-paper importer: without a private folder it refuses to run; with one it validates what it reads', () => {
  const saved = process.env.OLYMPIAD_PAPER_DIR;
  try {
    delete process.env.OLYMPIAD_PAPER_DIR;
    const { loadPaper } = require('../services/paperImport');
    const none = loadPaper(1);
    assert.equal(none.paper, null); assert.match(none.problems[0], /OLYMPIAD_PAPER_DIR/);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-'));
    const paper = { standard: 1, sections: [{ name: 'A' }], questions: [
      { n: 1, section: 0, text: 'fake question one', options: ['a', 'b', 'c', 'd'], answer: 2, marks: 1 },
      { n: 2, section: 0, text: 'fake question two', options: ['a', 'b', 'c', 'd'], answer: 9, marks: 1 },   // key out of range -> must be rejected
    ] };
    fs.writeFileSync(path.join(dir, 'std1.json'), JSON.stringify(paper));
    process.env.OLYMPIAD_PAPER_DIR = dir;
    const got = loadPaper(1);
    assert.ok(got.paper, 'reads from the private folder');
    assert.ok(got.problems.some((p) => /Q2: the correct answer is missing or out of range/.test(p)), 'a bad key is reported');
    fs.rmSync(dir, { recursive: true, force: true });
  } finally { if (saved === undefined) delete process.env.OLYMPIAD_PAPER_DIR; else process.env.OLYMPIAD_PAPER_DIR = saved; }
});

test('the question schema hides the answer key by default (it must be requested explicitly with +correctAnswer)', () => {
  const { OlympiadQuestion } = require('../models/Olympiad');
  const p = OlympiadQuestion.schema.path('correctAnswer');
  assert.ok(p, 'correctAnswer exists'); assert.equal(p.options.select, false);
});

test('no confidential data is tracked by Git (question banks with answer keys, keys, env files, dumps)', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-no-confidential-data.js')], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

// ───────────────────────── question-bank protection ─────────────────────────
const guardRun = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
  try {
    for (const [rel, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); }
    return spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-no-confidential-data.js')],
      { encoding: 'utf8', env: { ...process.env, CONFIDENTIAL_GUARD_ROOT: dir, CONFIDENTIAL_GUARD_FILES: Object.keys(files).join('\n') } });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};
const bankText = (head = '') => `${head}\nmodule.exports = [\n${Array.from({ length: 12 }, (_, i) => `  { q: 'x${i}', options: ['a','b','c','d'], correctAnswer: ${i % 4} },`).join('\n')}\n];\n`;

test('guard: an answer-key bank is rejected anywhere - including test, seed and data folders - unless it carries a valid declaration', () => {
  for (const where of ['backend/src/data/bank.js', 'backend/src/tests/bank.js', 'backend/src/seed/bank.js', 'frontend/e2e/bank.ts', 'docs/bank.md']) {
    const r = guardRun({ [where]: bankText() });
    assert.equal(r.status, 1, `${where} must be rejected`); assert.match(r.stderr, /question bank with answer keys/);
  }
  // other spellings of the key are caught too
  const alt = `module.exports = [\n${Array.from({ length: 10 }, (_, i) => `{ options: ['a','b'], correctOption: ${i % 2} },`).join('\n')}\n];`;
  assert.equal(guardRun({ 'backend/src/data/alt.js': alt }).status, 1);
});

test('guard: a declaration is honoured only in the matching folder, and is listed in the output', () => {
  assert.equal(guardRun({ 'backend/src/tests/fixtures/banks/a.js': bankText('// SYNTHETIC TEST FIXTURE - invented') }).status, 0);
  assert.equal(guardRun({ 'backend/src/data/a.js': bankText('// SYNTHETIC TEST FIXTURE - invented') }).status, 1, 'a fixture declaration does not work in a data folder');
  assert.equal(guardRun({ 'backend/src/seed/a.js': bankText('// PUBLIC DEMO CONTENT: demo') }).status, 0);
  assert.equal(guardRun({ 'backend/src/data/a.js': bankText('// PUBLIC DEMO CONTENT: demo') }).status, 1, 'a demo declaration does not work in a data folder');
  const ok = guardRun({ 'backend/src/seed/a.js': bankText('// PUBLIC DEMO CONTENT: demo') });
  assert.match(ok.stdout, /backend\/src\/seed\/a\.js \(declared public demo content\)/);
});

test('guard: exam documents, per-standard papers, keys and env files are rejected', () => {
  for (const f of ['docs/Olympiad_Paper_Std5.pdf', 'docs/BE_MCQ_Test_Paper.docx', 'exports/exam_questions.xlsx', 'backend/src/data/oct24/std1.json', 'backend/.env', 'mobile/release.keystore']) {
    assert.equal(guardRun({ [f]: 'x' }).status, 1, `${f} must be rejected`);
  }
  assert.equal(guardRun({ 'backend/.env.example': 'A=1', 'docs/README.md': '# hi' }).status, 0);
});

test('private bank loader: no folder -> refuses (no bundled fallback); unknown names and path tricks are rejected', () => {
  const saved = process.env.OLYMPIAD_BANK_DIR;
  try {
    delete process.env.OLYMPIAD_BANK_DIR;
    const { loadBank, isBankConfigured } = require('../services/privateBank');
    assert.equal(isBankConfigured(), false);
    assert.throws(() => loadBank('olympiad4Questions'), (e) => e.code === 'BANK_NOT_CONFIGURED');
    process.env.OLYMPIAD_BANK_DIR = os.tmpdir();
    for (const bad of ['../../etc/passwd', 'olympiad11Questions', 'olympiad4Questions.js', '', undefined]) assert.throws(() => loadBank(bad), /Unknown question bank/);
    assert.throws(() => loadBank('olympiad4Questions'), (e) => e.code === 'BANK_NOT_CONFIGURED', 'missing file in the folder is reported, not a crash');
  } finally { if (saved === undefined) delete process.env.OLYMPIAD_BANK_DIR; else process.env.OLYMPIAD_BANK_DIR = saved; }
});

test('auto-seed without a private bank folder changes nothing and reports why (start-up stays safe)', async () => {
  const saved = process.env.OLYMPIAD_BANK_DIR;
  try {
    delete process.env.OLYMPIAD_BANK_DIR;
    const seedAll = require('../seed/seedOlympiadAll');
    const r = await seedAll({ ifMissing: true });
    assert.deepEqual(r.exams, []); assert.equal(r.errors.length, 1); assert.equal(r.errors[0].err.code, 'BANK_NOT_CONFIGURED');
  } finally { if (saved === undefined) delete process.env.OLYMPIAD_BANK_DIR; else process.env.OLYMPIAD_BANK_DIR = saved; }
});

test('synthetic fixture banks mirror the structure of the real papers and are clearly marked', () => {
  const dir = path.join(__dirname, 'fixtures', 'banks');
  for (let std = 1; std <= 10; std++) {
    const f = path.join(dir, `olympiad${std}Questions.js`);
    assert.match(fs.readFileSync(f, 'utf8').slice(0, 300), /SYNTHETIC TEST FIXTURE/);
    const { sections, questions } = require(f);
    assert.equal(questions.length, std <= 3 ? 40 : 60);
    assert.equal(sections.reduce((s, x) => s + x.count, 0), questions.length);
    assert.ok(questions.every((q) => q.options.length === 4 && q.correctAnswer >= 0 && q.correctAnswer < 4 && /^Synthetic /.test(q.questionText)));
  }
});
