/** Exams-page tab rules for Olympiad cards (exam + teacher interview).   npm run test:unit */
import test from 'node:test';
import assert from 'node:assert/strict';
import { olympiadTab } from '../src/utils/examTabs.ts';

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
