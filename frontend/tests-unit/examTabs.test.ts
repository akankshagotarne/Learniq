/** Exams-page tab rules for Olympiad cards (exam + teacher interview).   npm run test:unit */
import test from 'node:test';
import assert from 'node:assert/strict';
import { olympiadTab, regularTabs, hasValidStandard } from '../src/utils/examTabs.ts';

const done = { state: 'completed' };
const iv = (stage: string) => ({ stage, workflowComplete: stage === 'COMPLETED' });

test('not purchased / purchased-not-submitted stay where they were', () => {
  assert.equal(olympiadTab({ state: 'pay' }, undefined), 'available');
  assert.equal(olympiadTab({ state: 'ready' }, iv('LOCKED')), 'available');
  assert.equal(olympiadTab({ state: 'in_progress' }, iv('LOCKED')), 'available');
  assert.equal(olympiadTab({ state: 'upcoming' }, undefined), 'upcoming');
});
test('submitted exam with an unfinished interview stays Available (not requested / waiting / live / evaluation pending)', () => {
  for (const stage of ['AVAILABLE', 'REQUESTED', 'IN_PROGRESS', 'EVALUATION_PENDING']) assert.equal(olympiadTab(done, iv(stage)), 'available', stage);
});
test('only a submitted evaluation (interview COMPLETED) moves the card to Completed', () => {
  assert.equal(olympiadTab(done, iv('COMPLETED')), 'completed');
});
test('cancelled / failed interviews come back as AVAILABLE and never count as completed', () => {
  assert.equal(olympiadTab(done, iv('AVAILABLE')), 'available');
});
test('exams without an interview (engineering mock test, or no interview info) keep the old behaviour', () => {
  assert.equal(olympiadTab(done, undefined), 'completed');
  assert.equal(olympiadTab({ state: 'completed', accessMode: 'approval' }, iv('AVAILABLE')), 'completed');
});
test('a refresh gives the same answer: the result depends only on the backend status', () => {
  assert.equal(olympiadTab(done, iv('REQUESTED')), olympiadTab(done, iv('REQUESTED')));
});

test('closed + never attempted -> Expired (never Available)', () => {
  assert.equal(olympiadTab({ state: 'closed' }, undefined), 'expired');
  assert.equal(olympiadTab({ state: 'closed' }, iv('LOCKED')), 'expired');
  assert.equal(olympiadTab({ state: 'closed', tab: 'expired' }, undefined), 'expired');
});
test('a submitted exam stays Completed after its deadline; registration alone does not complete it', () => {
  assert.equal(olympiadTab({ state: 'completed' }, undefined), 'completed');
  assert.equal(olympiadTab({ state: 'closed', registered: true }, undefined), 'expired');
});
test('the backend tab wins when it is present', () => {
  assert.equal(olympiadTab({ state: 'ready', tab: 'available' }, undefined), 'available');
  assert.equal(olympiadTab({ state: 'upcoming', tab: 'upcoming' }, undefined), 'upcoming');
});
test('regularTabs: attempted exams are never Expired; unattempted expired ones are', () => {
  assert.deepEqual(regularTabs({ availability: 'expired', myAttemptCount: 0 }), ['expired']);
  assert.ok(!regularTabs({ availability: 'expired', myAttemptCount: 1 }).includes('expired'));
  assert.ok(regularTabs({ availability: 'expired', myAttemptCount: 1 }).includes('completed'));
  assert.deepEqual(regularTabs({ availability: 'upcoming', myAttemptCount: 0 }), ['upcoming']);
});
test('hasValidStandard accepts 1-10 and Others, rejects blanks', () => {
  assert.equal(hasValidStandard(10), true);
  assert.equal(hasValidStandard('3'), true);
  assert.equal(hasValidStandard(undefined), false);
  assert.equal(hasValidStandard(''), false);
  assert.equal(hasValidStandard(null), false);
});

test('an Exam Only event: a submitted exam is Completed even though no interview is (or can be) unlocked', () => {
  assert.equal(olympiadTab({ state: 'completed', tab: 'completed', interviewUnlocked: false, interviewIncluded: false }), 'completed');
  assert.equal(olympiadTab({ state: 'completed', tab: 'completed', interviewUnlocked: false, interviewIncluded: false }, { stage: 'REQUESTED', workflowComplete: false }), 'completed');
  // an Exam + Interview (or legacy) event keeps the earlier rule: the interview is still to be bought / done
  assert.equal(olympiadTab({ state: 'completed', tab: 'completed', interviewUnlocked: false, interviewIncluded: true }), 'available');
  assert.equal(olympiadTab({ state: 'completed', tab: 'completed', interviewUnlocked: false }), 'available');
});
