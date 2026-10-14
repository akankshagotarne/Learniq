/** Standard-specific exam names ("LearnIQ Practice Test – 4th Standard") - seed config + idempotent sync of existing exams (title only). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeDb } = require('./helpers/fakeDb');
const fake = createFakeDb();
const { examTitleFor, syncOlympiadTitles, ordinal } = require('../seed/olympiadTitles');
const { configFor, STANDARDS } = require('../seed/olympiadConfigs');

const EXPECTED = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];

test('names follow the requested convention for Standards 1-10 (and ordinals are right)', () => {
  STANDARDS.forEach((std, i) => assert.equal(examTitleFor(std), `LearnIQ Practice Test – ${EXPECTED[i]} Standard`));
  assert.deepEqual([11, 12, 13, 21, 22, 23, 101].map(ordinal), ['11th', '12th', '13th', '21st', '22nd', '23rd', '101st']);
});

test('the seed config (source of truth for new databases) uses the new names, never the old one', () => {
  for (const std of STANDARDS) {
    const c = configFor(std);
    assert.equal(c.title, examTitleFor(std));
    assert.ok(!/All India Olympiad/.test(c.title));
    assert.equal(c.fee, 20, 'price unchanged');
  }
});

test('existing exams are renamed on start-up: title only, idempotent, other exams untouched', async () => {
  fake.OlympiadExam.docs.length = 0;
  for (const std of STANDARDS) {
    await fake.OlympiadExam.create({
      title: 'LearnIQ – All India Olympiad Examination 2026', slug: `learniq-all-india-olympiad-2026-std-${std}`, standard: std,
      examType: 'olympiad', fee: 20, totalMarks: 60, durationMinutes: 60, totalQuestions: 60, isPublished: true,
    });
  }
  const other = await fake.OlympiadExam.create({ title: 'BE Engineering Mock Test', slug: 'be-engineering', standard: 99, examType: 'engineering', fee: 0 });
  const before = fake.OlympiadExam.docs.map((d) => ({ ...d, title: undefined, updatedAt: undefined }));

  const first = await syncOlympiadTitles(fake.OlympiadExam);
  assert.deepEqual(first, { renamed: 10, unchanged: 0, missing: 0 });
  for (const std of STANDARDS) assert.equal(fake.OlympiadExam.docs.find((d) => d.standard === std && d.slug.includes('olympiad')).title, examTitleFor(std));
  assert.equal(fake.OlympiadExam.docs.find((d) => String(d._id) === String(other._id)).title, 'BE Engineering Mock Test', 'engineering exam untouched');
  const after = fake.OlympiadExam.docs.map((d) => ({ ...d, title: undefined, updatedAt: undefined }));
  assert.deepEqual(after, before, 'nothing except the title changed (fee, marks, duration, publish state ...)');

  const second = await syncOlympiadTitles(fake.OlympiadExam);
  assert.deepEqual(second, { renamed: 0, unchanged: 10, missing: 0 }, 'a second run changes nothing');
});

test('a missing exam is reported, not invented', async () => {
  fake.OlympiadExam.docs.length = 0;
  assert.deepEqual(await syncOlympiadTitles(fake.OlympiadExam, [3]), { renamed: 0, unchanged: 0, missing: 1 });
  assert.equal(fake.OlympiadExam.docs.length, 0);
});
