/**
 * scripts/deleteAllCourses.js — dry run, guards, delete, payments kept with their titles, and restore from the backup.
 * Runs against the in-memory fake models (no MongoDB).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeDb, FakeModel } = require('./helpers/fakeDb');
const { run, restore } = require('../scripts/deleteAllCourses');

const setup = async () => {
  const fake = createFakeDb();
  const CourseDoubt = new FakeModel('CourseDoubt', { registry: fake.registry });
  const AssignmentSubmission = new FakeModel('AssignmentSubmission', { registry: fake.registry });
  const Progress = new FakeModel('Progress', { registry: fake.registry });
  const models = {
    Course: fake.Course, Lecture: fake.Lecture, Note: fake.Note, Enrollment: fake.Enrollment, Payment: fake.Payment,
    LiveSession: fake.LiveSession, Quiz: fake.Quiz, Assignment: fake.Assignment, CourseDoubt, AssignmentSubmission, Progress,
  };
  // the real Mongoose insertMany, minus validation
  for (const m of Object.values(models)) m.insertMany = async (rows) => Promise.all(rows.map((r) => m.create(r)));

  const teacher = await fake.User.create({ name: 'T', email: 't@example.com', role: 'teacher' });
  const student = await fake.User.create({ name: 'S', email: 's@example.com', role: 'student' });
  const c1 = await fake.Course.create({ title: 'Maths Std 1', standard: 1, teacher: teacher._id });
  const c2 = await fake.Course.create({ title: 'Science Std 10', standard: 10, teacher: teacher._id });
  const lec = await fake.Lecture.create({ title: 'Lecture 1', course: c1._id, teacher: teacher._id });
  await fake.Note.create({ title: 'Notes 1', course: c2._id, teacher: teacher._id });
  await fake.Enrollment.create({ student: student._id, course: c1._id });
  const asg = await fake.Assignment.create({ title: 'HW', course: c1._id, teacher: teacher._id });
  await AssignmentSubmission.create({ assignment: asg._id, student: student._id });
  await CourseDoubt.create({ course: c2._id, student: student._id, teacher: teacher._id });
  await Progress.create({ student: student._id, standard: 1, course: c1._id });
  const stdProgress = await Progress.create({ student: student._id, standard: 9 }); // no course → kept
  const session = await fake.LiveSession.create({ title: 'Live', course: c1._id, teacher: teacher._id });
  const quiz = await fake.Quiz.create({ title: 'Quiz', course: c2._id, teacher: teacher._id });
  const pCourse = await fake.Payment.create({ student: student._id, course: c1._id, type: 'course', amount: 499, status: 'completed' });
  const pLecture = await fake.Payment.create({ student: student._id, lecture: lec._id, type: 'lecture', amount: 49, status: 'completed' });
  const files = {};
  const deps = { models, dbName: 'learniq', writeFile: (f, c) => { files[f] = c; }, readFile: (f) => files[f], log: () => {} };
  return { fake, models, deps, files, ids: { c1, session, quiz, pCourse, pLecture, stdProgress } };
};

test('dry run changes nothing, writes a backup and prints the guarded command', async () => {
  const { models, deps, files } = await setup();
  const lines = [];
  const r = await run({ ...deps, log: (l) => lines.push(l) }, {});
  assert.equal(r.applied, false);
  assert.equal(r.counts.Course, 2);
  assert.equal(models.Course.docs.length, 2);
  assert.ok(files[r.backupFile], 'backup written');
  assert.equal(JSON.parse(files[r.backupFile]).Course.length, 2);
  assert.ok(lines.some((l) => l.includes('--apply --confirm-db=learniq --expect-courses=2')));
});

test('apply is refused without the right database name or course count', async () => {
  const { models, deps } = await setup();
  await assert.rejects(run(deps, { apply: true, expectCourses: 2 }), /confirm-db=learniq/);
  await assert.rejects(run(deps, { apply: true, confirmDb: 'other', expectCourses: 2 }), /confirm-db=learniq/);
  await assert.rejects(run(deps, { apply: true, confirmDb: 'learniq', expectCourses: 5 }), /does not match the 2 courses/);
  assert.equal(models.Course.docs.length, 2, 'nothing deleted');
});

test('apply deletes every course and its content, keeps payments (with titles), sessions and quizzes', async () => {
  const { models, deps, ids } = await setup();
  const r = await run(deps, { apply: true, confirmDb: 'learniq', expectCourses: 2 });
  assert.equal(r.applied, true);
  for (const k of ['Course', 'Lecture', 'Note', 'Enrollment', 'CourseDoubt', 'Assignment', 'AssignmentSubmission']) {
    assert.equal(models[k].docs.length, 0, `${k} emptied`);
  }
  assert.deepEqual(models.Progress.docs.map((d) => String(d._id)), [String(ids.stdProgress._id)], 'only course progress removed');

  const pay = (p) => models.Payment.docs.find((d) => String(d._id) === String(p._id));
  assert.equal(models.Payment.docs.length, 2, 'payments kept');
  assert.equal(pay(ids.pCourse).itemTitle, 'Maths Std 1');
  assert.equal(pay(ids.pLecture).itemTitle, 'Lecture 1');

  const session = models.LiveSession.docs.find((d) => String(d._id) === String(ids.session._id));
  const quiz = models.Quiz.docs.find((d) => String(d._id) === String(ids.quiz._id));
  assert.ok(session && quiz, 'live session and quiz kept');
  assert.equal(session.course, undefined);
  assert.equal(quiz.course, undefined);
});

test('restore puts everything back from the backup', async () => {
  const { models, deps, ids } = await setup();
  const r = await run(deps, { apply: true, confirmDb: 'learniq', expectCourses: 2 });
  await assert.rejects(restore(deps, { restore: r.backupFile, apply: true, confirmDb: 'nope' }), /confirm-db=learniq/);
  await restore(deps, { restore: r.backupFile, apply: true, confirmDb: 'learniq' });
  assert.equal(models.Course.docs.length, 2);
  assert.equal(models.Lecture.docs.length, 1);
  assert.equal(models.Enrollment.docs.length, 1);
  assert.equal(models.AssignmentSubmission.docs.length, 1);
  const session = models.LiveSession.docs.find((d) => String(d._id) === String(ids.session._id));
  assert.equal(String(session.course), String(ids.c1._id), 'live session re-linked');
});
