/* Unit tests for the per-event paper sets (24 Oct, 31 Oct and 11 Nov 2026). Uses invented data only: SYNTHETIC TEST FIXTURE (no real paper). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const sets = require('../config/paperSets');
const { loadPaper } = require('../services/paperImport');

test('each event day maps to its own set; unknown days map to none', () => {
  assert.equal(sets.byDay('2026-10-24').PAPER_SET, 'oct24-2026');
  assert.equal(sets.byDay('2026-10-31').PAPER_SET, 'oct31-2026');
  assert.equal(sets.byDay('2026-11-11').PAPER_SET, 'nov11-2026');
  assert.equal(sets.byDay('2026-11-07'), null);
  assert.equal(sets.bySet('oct31-2026').EVENT_DAY, '2026-10-31');
});

test('the 31 Oct set reads its papers from the oct31 sub-folder and never overwrites event settings', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-'));
  const old = process.env.OLYMPIAD_PAPER_DIR; process.env.OLYMPIAD_PAPER_DIR = base;
  try {
    const cfg = sets.byDay('2026-10-31');
    assert.equal(cfg.DATA_DIR, path.join(base, 'oct31'));
    assert.equal(cfg.APPLY_EVENT_SETTINGS, false);
    assert.match(loadPaper(1, undefined, cfg).problems[0], /std1\.json is missing/);
    fs.mkdirSync(path.join(base, 'oct31'));
    const paper = { standard: 1, bilingual: false, sections: [{ name: 'Maths' }], questions: [{ n: 1, text: 'Invented 1 + 1?', options: ['1', '2', '3', '4'], answer: 1, section: 0, marks: 1, image: 'data:image/png;base64,AAAA' }] };
    fs.writeFileSync(path.join(base, 'oct31', 'std1.json'), JSON.stringify(paper));
    const r = loadPaper(1, undefined, cfg);
    assert.deepEqual(r.problems, []);
    assert.equal(r.paper.questions[0].image.startsWith('data:image/png'), true);
  } finally { if (old === undefined) delete process.env.OLYMPIAD_PAPER_DIR; else process.env.OLYMPIAD_PAPER_DIR = old; }
});

test('the 11 Nov set reads its papers from the nov11 sub-folder, keeps event settings and expects 540 questions', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-'));
  const old = process.env.OLYMPIAD_PAPER_DIR; process.env.OLYMPIAD_PAPER_DIR = base;
  try {
    const cfg = sets.byDay('2026-11-11');
    assert.equal(cfg.DATA_DIR, path.join(base, 'nov11'));
    assert.equal(cfg.APPLY_EVENT_SETTINGS, false);
    assert.deepEqual(Object.values(cfg.durations), [60, 60, 60, 90, 90, 120, 120, 120, 120, 120]);
    assert.equal(Object.values(cfg.expectedQuestions).reduce((a, b) => a + b, 0), 540);
    assert.match(loadPaper(1, undefined, cfg).problems[0], /std1\.json is missing/);
  } finally { if (old === undefined) delete process.env.OLYMPIAD_PAPER_DIR; else process.env.OLYMPIAD_PAPER_DIR = old; }
});
