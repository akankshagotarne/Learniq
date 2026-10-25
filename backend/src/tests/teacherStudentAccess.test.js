/** A teacher may only open the detail of a student enrolled in one of THEIR courses (GET /api/teacher/students/:id). */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const SRC = path.join(__dirname, '..');
const chain = (rows) => { const c = { populate: () => c, sort: () => c, select: () => c, then: (r, j) => Promise.resolve(rows).then(r, j) }; return c; };
const users = {
  stuA: { _id: 'stuA', role: 'student', name: 'A' }, stuB: { _id: 'stuB', role: 'student', name: 'B' },
  tchOther: { _id: 'tchOther', role: 'teacher', name: 'T2' }, adm: { _id: 'adm', role: 'admin', name: 'Root' },
};
const enrollments = [{ student: 'stuA', course: 'c1' }, { student: 'stuB', course: 'c2' }];
const courses = [{ _id: 'c1', teacher: 'tchMine' }, { _id: 'c2', teacher: 'tchOther' }];
const empty = { find: () => chain([]), countDocuments: async () => 0 };
const overrides = {
  [path.join(SRC, 'models', 'User.js')]: { findById: (id) => chain(users[id] || null) },
  [path.join(SRC, 'models', 'Course.js')]: { find: (q) => chain(courses.filter((c) => String(c.teacher) === String(q.teacher))) },
  [path.join(SRC, 'models', 'Lecture.js')]: empty,
  [path.join(SRC, 'models', 'index.js')]: {
    Enrollment: { find: (q) => chain(enrollments.filter((e) => e.student === q.student && (!q.course || q.course.$in.includes(e.course)))) },
    Notification: empty, Progress: empty,
  },
  [path.join(SRC, 'models', 'Quiz.js')]: { Quiz: empty, QuizAttempt: empty },
  [path.join(SRC, 'models', 'Assignment.js')]: { Assignment: empty, AssignmentSubmission: empty },
  [path.join(SRC, 'models', 'LiveSession.js')]: { LiveSession: empty, LiveParticipant: empty },
  [path.join(SRC, 'services', 'paymentStats.js')]: {},
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  let r; try { r = Module._resolveFilename(request, parent, isMain); } catch { return originalLoad.apply(this, arguments); }
  return overrides[r] || originalLoad.apply(this, arguments);
};
test.after(() => { Module._load = originalLoad; });

const { getStudentDetail } = require('../controllers/userController');
const call = async (user, id) => {
  const out = {};
  await getStudentDetail({ params: { id }, user }, { status(c) { out.code = c; return this; }, json(b) { out.body = b; return this; } });
  if (!out.code) out.code = 200;
  return out;
};

test('teacher opens a student enrolled in their own course', async () => {
  const r = await call({ _id: 'tchMine', role: 'teacher' }, 'stuA');
  assert.equal(r.code, 200); assert.equal(r.body.student._id, 'stuA'); assert.equal(r.body.enrollments.length, 1);
});
test('teacher cannot open a student who is only in another teacher\'s course (404, not 403)', async () => {
  assert.equal((await call({ _id: 'tchMine', role: 'teacher' }, 'stuB')).code, 404);
});
test('teacher cannot open a non-student account (another teacher / admin)', async () => {
  assert.equal((await call({ _id: 'tchMine', role: 'teacher' }, 'tchOther')).code, 404);
  assert.equal((await call({ _id: 'tchMine', role: 'teacher' }, 'adm')).code, 404);
});
test('admin can open any student and sees all their enrollments', async () => {
  const r = await call({ _id: 'adm', role: 'admin' }, 'stuB');
  assert.equal(r.code, 200); assert.equal(r.body.enrollments.length, 1);
});
