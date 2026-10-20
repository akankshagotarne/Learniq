/** "Who can join this meeting?" client rules: choices, validation, summary.   npm run test:unit */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_AUDIENCE, audienceFor, audienceLabel, choiceOf, clone, describeStandards, summarizeAudience, toggle, validateAudience } from '../src/features/live/audience.ts';

const sel = { standards: [10, 8, 9], studentIds: ['s1', 's2'], teacherIds: ['t1'] };

test('every choice maps to the matching audience and back', () => {
  const cases: [any, string, string][] = [['all_students', 'all', 'none'], ['one_standard', 'standard', 'none'], ['multi_standards', 'standards', 'none'], ['students', 'students', 'none'], ['all_teachers', 'none', 'all'], ['selected_teachers', 'none', 'selected'], ['both', 'all', 'all']];
  for (const [choice, s, t] of cases) {
    const a = audienceFor(choice, sel);
    assert.equal(a.students.mode, s, choice); assert.equal(a.teachers.mode, t, choice);
    assert.equal(choiceOf(a), choice, `${choice} round-trips`);
  }
});

test('only the chosen mode keeps its selection (no hidden leftovers widen or narrow access)', () => {
  assert.deepEqual(audienceFor('all_students', sel).students, { mode: 'all', standards: [], studentIds: [] });
  assert.deepEqual(audienceFor('one_standard', sel).students.standards, [10], 'one standard keeps exactly one');
  assert.deepEqual(audienceFor('multi_standards', sel).students.standards, [10, 8, 9]);
  assert.deepEqual(audienceFor('students', sel).students.studentIds, ['s1', 's2']);
  assert.deepEqual(audienceFor('students', sel).teachers.teacherIds, []);
  assert.deepEqual(audienceFor('selected_teachers', sel).teachers.teacherIds, ['t1']);
});

test('validation: empty or contradictory selections are refused with a clear message; older classes (no audience) are not blocked', () => {
  assert.equal(validateAudience(undefined), null);
  assert.equal(validateAudience(clone(DEFAULT_AUDIENCE)), null);
  assert.match(validateAudience(audienceFor('multi_standards', { ...sel, standards: [] }))!, /at least one standard/i);
  assert.match(validateAudience(audienceFor('one_standard', { ...sel, standards: [] }))!, /one standard/i);
  assert.match(validateAudience(audienceFor('students', { ...sel, studentIds: [] }))!, /at least one student/i);
  assert.match(validateAudience(audienceFor('selected_teachers', { ...sel, teacherIds: [] }))!, /at least one teacher/i);
  const nobody = clone(DEFAULT_AUDIENCE); nobody.students.mode = 'none';
  assert.match(validateAudience(nobody)!, /at least one group/i);
  const both = audienceFor('both', { ...sel, teacherIds: [] }); both.teachers.mode = 'selected';
  assert.match(validateAudience(both)!, /at least one teacher/i);
  assert.equal(validateAudience(audienceFor('all_students', { standards: [], studentIds: [], teacherIds: [] })), null, 'All Students needs no standards');
});

test('the access summary is computed from the audience, not hardcoded', () => {
  const a = audienceFor('both', sel); a.students.mode = 'standards'; a.students.standards = [10, 8, 9]; a.teachers.mode = 'selected'; a.teachers.teacherIds = ['t1', 't2'];
  assert.deepEqual(summarizeAudience(a), { students: 'Standards 8, 9 and 10', teachers: '2 selected teachers', access: 'Authenticated eligible accounts only' });
  assert.equal(summarizeAudience(audienceFor('students', { ...sel, studentIds: ['x'] })).students, '1 selected student');
  assert.equal(summarizeAudience(audienceFor('all_students', sel)).teachers, 'No teachers');
  assert.equal(describeStandards([99, 9]), 'Standard 9 and Others');
  assert.equal(describeStandards([10]), 'Standard 10');
  assert.match(summarizeAudience(undefined).students, /all signed-in students/i);
  assert.equal(audienceLabel(a), 'Standards 8, 9 and 10 + 2 selected teachers');
  assert.equal(audienceLabel(audienceFor('all_teachers', sel)), 'All teachers');
});

test('toggle never creates duplicates', () => {
  assert.deepEqual(toggle(['a'], 'a'), []);
  assert.deepEqual(toggle(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggle(toggle([] as number[], 8), 8), []);
});
