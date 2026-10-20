/**
 * Group A - live MCQ: the server-authoritative engine, driven through the REAL Socket.IO signalling with real socket.io clients.
 * The answering window and the rank-card time are shortened (700 ms / 300 ms) by injecting the durations; the production values are 15 s / 5 s.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startLive } = require('./helpers/liveHarness');
const { rankOf, validateInput } = require('../services/live/mcqEngine');

const WINDOW = 700;
const RANKING = 300;
let h;
test.before(async () => { h = await startLive({ windowMs: WINDOW, rankingMs: RANKING, failResponseSaves: true }); });
test.after(async () => { await h.close(); });

const Q = (over = {}) => ({ question: 'What is 2 + 2?', options: ['3', '4', '5', '6'], correctIndex: 1, requestId: `r-${Math.random().toString(36).slice(2)}`, ...over });

/** a running class: the teacher plus N approved students */
const classroom = async (names = ['Asha', 'Bala', 'Chitra', 'Dev'], { standards = [] } = {}) => {
  const teacher = await h.user(`Teacher ${Math.random().toString(36).slice(2, 6)}`, 'teacher');
  const session = await h.session(teacher);
  const host = await h.connect(teacher);
  await host.join(session.sessionCode);
  const students = [];
  for (let i = 0; i < names.length; i += 1) {
    const u = await h.user(`${names[i]} ${Math.random().toString(36).slice(2, 6)}`, 'student', standards[i] !== undefined ? { currentStandard: standards[i] } : {});
    const c = await h.connect(u);
    await c.join(session.sessionCode);
    const req = await host.wait('join-request', (p) => p.userId === String(u._id));
    assert.equal((await host.emit('approve-join', { targetSocketId: req.socketId })).ok, true);
    await c.wait('joined');
    students.push(Object.assign(c, { user: u }));
  }
  return { teacher, session, host, students };
};
const raised = (c) => c.wait('mcq-raised').then((p) => p.mcq);
const dbCount = (mcqId) => h.models.LiveMcqResponse.docs.filter((d) => String(d.mcq) === String(mcqId)).length;

test('A1. the host launches; every eligible student gets the same server-timed question, without the correct answer', async () => {
  const { host, students } = await classroom();
  const launch = await host.emit('raise-mcq', Q());
  assert.equal(launch.ok, true);
  assert.equal(launch.closesAt - launch.openedAt, WINDOW);
  const seen = await Promise.all(students.map(raised));
  seen.forEach((m) => {
    assert.equal(m.mcqId, launch.mcqId);
    assert.equal(m.openedAt, launch.openedAt);
    assert.equal(m.closesAt, launch.closesAt);
    assert.equal(m.options.length, 4);
    assert.equal(m.correctIndex, undefined, 'the answer is not in the question sent to students');
  });
  assert.equal((await host.wait('mcq-teacher-info')).correctIndex, 1, 'only the host is told the answer');
  await host.wait('mcq-ranking-ended', null, 3000);
});

test('A2. nothing about the correct answer or the ranking reaches a student before the window closes', async () => {
  const { host, students } = await classroom(['Esha', 'Farid']);
  const launch = await host.emit('raise-mcq', Q({ correctIndex: 2 }));
  await students[0].emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 2 });
  await h.sleep(WINDOW / 2);
  for (const s of students) {
    const so = JSON.stringify(s.events.filter((e) => !['mcq-closed', 'mcq-my-result', 'mcq-ranking', 'mcq-ranking-ended', 'scoreboard-update'].includes(e.name)));
    assert.ok(!/correctIndex/.test(so), 'no correctIndex in any pre-close event');
    assert.equal(s.count('mcq-ranking'), 0);
    assert.equal(s.count('mcq-progress'), 0, 'submission counts are for the host only');
    assert.equal(s.count('mcq-host-results'), 0);
  }
  await students[0].wait('mcq-ranking');
});

test('A3. the answer time is measured by the server from the official start (a client-supplied time is ignored)', async () => {
  const { host, students } = await classroom(['Gita']);
  const launch = await host.emit('raise-mcq', Q());
  await h.sleep(120);
  const ack = await students[0].emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 1, answerTimeMs: 1, submittedAt: 0, responseTimeSec: 0.001, isCorrect: false });
  assert.equal(ack.ok, true);
  assert.ok(ack.answerTimeMs >= 100 && ack.answerTimeMs < 400, `server time ${ack.answerTimeMs}`);
  const stored = h.models.LiveMcqResponse.docs.find((d) => String(d.mcq) === launch.mcqId);
  assert.equal(stored.answerTimeMs, ack.answerTimeMs);
  assert.equal(stored.isCorrect, true, 'correctness is decided by the server');
});

test('A4. an early submitter is acknowledged (popup can close); the others keep answering until the deadline', async () => {
  const { host, students } = await classroom(['Hari', 'Indu', 'Jay']);
  const launch = await host.emit('raise-mcq', Q());
  const first = await students[0].emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 1 });
  assert.equal(first.ok, true);
  assert.equal(students[0].count('mcq-closed'), 0, 'the class window is still open after one student submitted');
  await h.sleep(150);
  const second = await students[1].emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 0 });
  assert.equal(second.ok, true, 'a student who has not answered can still answer');
  await students[2].wait('mcq-closed');
  assert.equal(dbCount(launch.mcqId), 2);
});

test('A5. an answer after the deadline is refused and nothing is stored', async () => {
  const { host, students } = await classroom(['Kiran']);
  const launch = await host.emit('raise-mcq', Q());
  await students[0].wait('mcq-closed');
  const late = await students[0].emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 1 });
  assert.equal(late.ok, false);
  assert.match(late.code, /QUESTION_CLOSED|STALE_QUESTION/);
  assert.equal(dbCount(launch.mcqId), 0);
});

test('A6. only the first answer counts: changing it is refused and the stored answer is returned', async () => {
  const { host, students } = await classroom(['Lata']);
  const launch = await host.emit('raise-mcq', Q());
  const a = await students[0].emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 0 });
  const b = await students[0].emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 1 });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(b.alreadySubmitted, true);
  assert.equal(b.selectedOption, 0, 'the original answer stands');
  assert.equal(dbCount(launch.mcqId), 1);
});

test('A7. duplicate submit events fired together (double tap) store exactly one answer; the older tab of the same student is retired', async () => {
  const { host, students, session } = await classroom(['Manu']);
  const second = await h.connect(students[0].user);
  await second.join(session.sessionCode);
  await second.wait('joined');
  await students[0].wait('replaced-by-new-connection');
  const launch = await host.emit('raise-mcq', Q());
  const stale = await students[0].emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 1 });
  assert.equal(stale.ok, false, 'the replaced tab is no longer in the class');
  const acks = await Promise.all([
    second.emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 1 }),
    second.emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 1 }),
    second.emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 1 }),
  ]);
  assert.ok(acks.every((a) => a.ok));
  assert.equal(dbCount(launch.mcqId), 1);
  await second.wait('mcq-ranking');
  assert.equal(second.last('mcq-ranking').ranking.length, 1, 'the student appears once in the ranking');
});

test('A8. top 3: only correct answers, fastest first, with rank, name, standard and the elapsed time', async () => {
  const { host, students } = await classroom(['Nila', 'Om', 'Pia', 'Quin'], { standards: [6, 7, 8, 99] });
  const launch = await host.emit('raise-mcq', Q());
  await students[2].emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 1 }); // Pia, fastest
  await h.sleep(60);
  await students[0].emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 0 }); // Nila, wrong
  await h.sleep(60);
  await students[3].emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 1 }); // Quin
  await h.sleep(60);
  await students[1].emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 1 }); // Om
  const card = await students[0].wait('mcq-ranking');
  assert.equal(card.title, 'LearnIQ — MCQ Champions');
  assert.equal(card.noQualifying, false);
  assert.deepEqual(card.ranking.map((r) => r.rank), [1, 2, 3]);
  assert.deepEqual(card.ranking.map((r) => r.userId), [students[2], students[3], students[1]].map((s) => String(s.user._id)));
  assert.deepEqual(card.ranking.map((r) => r.standard), ['Standard 8', 'Others', 'Standard 7']);
  card.ranking.forEach((r) => { assert.match(r.answerTimeLabel, /^\d+\.\d sec$/); assert.ok(r.answerTimeMs >= 0); });
  assert.ok(card.ranking[0].answerTimeMs <= card.ranking[1].answerTimeMs && card.ranking[1].answerTimeMs <= card.ranking[2].answerTimeMs);
  assert.ok(!card.ranking.some((r) => r.userId === String(students[0].user._id)), 'a wrong answer never ranks');
  // everyone sees the same card
  for (const s of students) assert.deepEqual((await s.wait('mcq-ranking')).ranking, card.ranking);
});

test('A9. fewer than three correct answers: the card lists only those, without placeholders', async () => {
  const { host, students } = await classroom(['Ravi', 'Sana', 'Tara']);
  const launch = await host.emit('raise-mcq', Q());
  await students[0].emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 1 });
  await students[1].emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 3 });
  const card = await students[2].wait('mcq-ranking');
  assert.equal(card.ranking.length, 1);
  assert.equal(card.noQualifying, false);
});

test('A10. nobody answered correctly: a "none correct" card is shown for the same 5 s slot', async () => {
  const { host, students } = await classroom(['Uma', 'Vik']);
  const launch = await host.emit('raise-mcq', Q());
  await students[0].emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 0 });
  const card = await students[1].wait('mcq-ranking');
  assert.equal(card.noQualifying, true);
  assert.deepEqual(card.ranking, []);
  assert.equal(card.displayMs, RANKING);
});

test('A11. nobody answered at all: same none-correct card; the question closes on time', async () => {
  const { host, students } = await classroom(['Wasim']);
  const launch = await host.emit('raise-mcq', Q());
  const closed = await students[0].wait('mcq-closed');
  assert.equal(closed.mcqId, launch.mcqId);
  assert.equal(closed.reason, 'timeout');
  const my = await students[0].wait('mcq-my-result');
  assert.equal(my.answered, false);
  assert.equal((await students[0].wait('mcq-ranking')).noQualifying, true);
});

test('A12. the rank card disappears on its own after its display time, and a new question can then be launched', async () => {
  const { host, students } = await classroom(['Xena']);
  const l1 = await host.emit('raise-mcq', Q());
  const shown = await students[0].wait('mcq-ranking');
  const t0 = students[0].events.find((e) => e.name === 'mcq-ranking').at;
  await students[0].wait('mcq-ranking-ended');
  const dt = students[0].events.find((e) => e.name === 'mcq-ranking-ended').at - t0;
  assert.ok(dt >= RANKING - 30 && dt < RANKING + 400, `card shown for ${dt} ms`);
  assert.equal(shown.endsAt - shown.shownAt, RANKING);
  const l2 = await host.emit('raise-mcq', Q());
  assert.equal(l2.ok, true);
  assert.notEqual(l2.mcqId, l1.mcqId);
  await students[0].wait('mcq-ranking-ended', null, 3000, { fresh: true }).catch(() => {});
});

test('A13. ties are broken deterministically: server timestamp, then arrival order, then user id', () => {
  const mk = (userId, answerTimeMs, submittedAt, seq) => ({ userId, isCorrect: true, answerTimeMs, submittedAt, seq });
  const map = new Map([['u3', mk('u3', 2000, 5, 3)], ['u1', mk('u1', 2000, 5, 1)], ['u2', mk('u2', 2000, 4, 2)], ['u0', mk('u0', 1500, 9, 4)]]);
  assert.deepEqual(rankOf(map).map((r) => r.userId), ['u0', 'u2', 'u1', 'u3']);
  const sameEverything = new Map([['b', mk('b', 1000, 1, 0)], ['a', mk('a', 1000, 1, 0)]]);
  assert.deepEqual(rankOf(sameEverything).map((r) => r.userId), ['a', 'b'], 'the final tie-break is the user id');
  const wrong = new Map([['x', { userId: 'x', isCorrect: false, answerTimeMs: 1, submittedAt: 1, seq: 1 }]]);
  assert.equal(rankOf(wrong).length, 0);
});

test('A14. a student (or another teacher) cannot launch or close a question, and the attempt is audited', async () => {
  const { host, students, session } = await classroom(['Yash']);
  const before = h.models.LiveAdminAudit.docs.length;
  const byStudent = await students[0].emit('raise-mcq', Q());
  assert.equal(byStudent.ok, false);
  assert.equal(byStudent.code, 'NOT_AUTHORIZED');
  const other = await h.user('Other Teacher', 'teacher');
  const oc = await h.connect(other);
  await oc.join(session.sessionCode);
  const byOther = await oc.emit('raise-mcq', Q());
  assert.equal(byOther.ok, false, 'a waiting teacher who does not own the class cannot launch');
  assert.equal(students[0].count('mcq-raised'), 0);
  const real = await host.emit('raise-mcq', Q());
  const closeByStudent = await students[0].emit('close-mcq', {});
  assert.equal(closeByStudent.ok, false);
  assert.equal(h.manager.get(session.sessionCode).mcq.state, 'open', 'still open');
  assert.ok(h.models.LiveAdminAudit.docs.length > before, 'rejected attempts are written to the audit trail');
  assert.ok(h.models.LiveAdminAudit.docs.some((d) => d.action === 'UNAUTHORIZED_ATTEMPT'));
  await students[0].wait('mcq-closed');
  assert.equal(real.ok, true);
});

test('A15. a duplicate launch (double click / retry with the same request id) is one question', async () => {
  const { host, students } = await classroom(['Zoya', 'Arun']);
  const body = Q({ requestId: 'same-click' });
  const [a, b] = await Promise.all([host.emit('raise-mcq', body), host.emit('raise-mcq', body)]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.mcqId, b.mcqId);
  await h.sleep(50);
  assert.equal(students[0].count('mcq-raised'), 1, 'students see the popup once');
  assert.equal(h.models.LiveMcq.docs.filter((d) => d.requestId === 'same-click').length, 1);
  await students[0].wait('mcq-ranking-ended');
});

test('A16. a second question cannot be launched while one is open or while its rank card is on screen', async () => {
  const { host, students } = await classroom(['Bina']);
  assert.equal((await host.emit('raise-mcq', Q())).ok, true);
  const during = await host.emit('raise-mcq', Q());
  assert.equal(during.ok, false);
  assert.match(during.code, /MCQ_ACTIVE|MCQ_BUSY/);
  await students[0].wait('mcq-ranking');
  const ranking = await host.emit('raise-mcq', Q());
  assert.equal(ranking.ok, false, 'overlays never stack');
  await students[0].wait('mcq-ranking-ended');
  assert.equal((await host.emit('raise-mcq', Q())).ok, true);
});

test('A17. invalid questions are refused before anything reaches students', async () => {
  const { host, students } = await classroom(['Cyrus']);
  for (const bad of [Q({ question: ' ' }), Q({ options: ['only one'] }), Q({ options: ['a', 'b', 'c', 'd', 'e'] }), Q({ correctIndex: 4 }), Q({ correctIndex: 'x' }), Q({ options: ['same', 'Same'] }), Q({ options: ['a', ''] })]) {
    const r = await host.emit('raise-mcq', bad);
    assert.equal(r.ok, false);
  }
  await h.sleep(40);
  assert.equal(students[0].count('mcq-raised'), 0);
  assert.throws(() => validateInput({ question: 'ok?', options: ['a', 'b'], correctIndex: 5 }));
});

test('A18. reconnect BEFORE answering: the student gets the same question with the time that is really left', async () => {
  const { host, students, session } = await classroom(['Dia']);
  const launch = await host.emit('raise-mcq', Q());
  await students[0].wait('mcq-raised');
  students[0].close();
  await h.sleep(250);
  const again = await h.connect(students[0].user);
  await again.join(session.sessionCode);
  const joined = await again.wait('joined');
  assert.equal(joined.mcq.state, 'open');
  assert.equal(joined.mcq.mcq.mcqId, launch.mcqId);
  assert.equal(joined.mcq.mcq.closesAt, launch.closesAt, 'the deadline did not move');
  assert.ok(joined.mcq.mcq.remainingMs < WINDOW - 200, `remaining ${joined.mcq.mcq.remainingMs}`);
  assert.equal(joined.mcq.submitted, false);
  const ack = await again.emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 1 });
  assert.equal(ack.ok, true);
});

test('A19. reconnect AFTER answering: the submitted state is restored and the popup stays closed', async () => {
  const { host, students, session } = await classroom(['Eli']);
  const launch = await host.emit('raise-mcq', Q());
  const ack = await students[0].emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 2 });
  students[0].close();
  await h.sleep(100);
  const again = await h.connect(students[0].user);
  await again.join(session.sessionCode);
  const joined = await again.wait('joined');
  assert.equal(joined.mcq.state, 'open');
  assert.equal(joined.mcq.submitted, true);
  assert.equal(joined.mcq.selectedOption, 2);
  assert.equal(joined.mcq.answerTimeMs, ack.answerTimeMs);
  const retry = await again.emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 1 });
  assert.equal(retry.alreadySubmitted, true);
  assert.equal(retry.selectedOption, 2);
});

test('A20. a student who joins while the window is open sees the question with the remaining time; after it, the idle state', async () => {
  const { host, session } = await classroom([]);
  const launch = await host.emit('raise-mcq', Q());
  await h.sleep(200);
  const late = await h.user('Late Joiner', 'student');
  const c = await h.connect(late);
  await c.join(session.sessionCode);
  const req = await host.wait('join-request', (p) => p.userId === String(late._id));
  await host.emit('approve-join', { targetSocketId: req.socketId });
  const joined = await c.wait('joined');
  assert.equal(joined.mcq.state, 'open');
  assert.ok(joined.mcq.mcq.remainingMs <= WINDOW - 180);
  assert.equal(joined.mcq.mcq.mcqId, launch.mcqId);
  await c.wait('mcq-ranking-ended');
  const probe = await c.emit('get-mcq-state', {});
  assert.equal(probe.state, 'idle');
});

test('A21. the host can close early; students who had not answered are told, and the ranking is still computed', async () => {
  const { host, students } = await classroom(['Fay', 'Gus']);
  const launch = await host.emit('raise-mcq', Q());
  await students[0].emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 1 });
  const closed = await host.emit('close-mcq', {});
  assert.equal(closed.ok, true);
  const msg = await students[1].wait('mcq-closed');
  assert.equal(msg.reason, 'host');
  assert.equal((await students[1].wait('mcq-my-result')).answered, false);
  assert.equal((await students[1].wait('mcq-ranking')).ranking.length, 1);
  const again = await host.emit('close-mcq', {});
  assert.equal(again.ok, false, 'closing twice is harmless');
});

test('A22. the host sees live submission counts and, after the close, the full results; students never do', async () => {
  const { host, students } = await classroom(['Hema', 'Ivan', 'Juhi']);
  const launch = await host.emit('raise-mcq', Q());
  await students[0].emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 1 });
  const progress = await host.wait('mcq-progress', (p) => p.submitted === 1);
  assert.equal(progress.eligible, 3);
  await students[1].emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 0 });
  await host.wait('mcq-progress', (p) => p.submitted === 2);
  const results = await host.wait('mcq-host-results');
  assert.equal(results.correctIndex, 1);
  assert.equal(results.totals.submitted, 2);
  assert.equal(results.totals.correct, 1);
  assert.equal(results.notAnswered.length, 1);
  assert.equal(results.results.length, 2);
  students.forEach((s) => { assert.equal(s.count('mcq-host-results'), 0); assert.equal(s.count('mcq-progress'), 0); });
});

test('A23. a failed save is NOT acknowledged; a retry inside the window succeeds and is acknowledged once', async () => {
  const { host, students } = await classroom(['Kavi']);
  const launch = await host.emit('raise-mcq', Q());
  h.models.LiveMcqResponse.failNext = 1;
  const failed = await students[0].emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 1 });
  assert.equal(failed.ok, false, 'no false confirmation');
  assert.equal(failed.retryable, true);
  assert.equal(dbCount(launch.mcqId), 0);
  const retry = await students[0].emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 1 });
  assert.equal(retry.ok, true);
  assert.equal(dbCount(launch.mcqId), 1);
  assert.equal((await students[0].wait('mcq-ranking')).ranking.length, 1);
});

test('A24. an answer for another (older) question, an invalid option or a non-student sender is refused', async () => {
  const { host, students } = await classroom(['Lena']);
  const launch = await host.emit('raise-mcq', Q());
  assert.equal((await students[0].emit('submit-mcq-answer', { mcqId: '000000000000000000000000', selectedOption: 1 })).ok, false);
  assert.equal((await students[0].emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 9 })).code, 'INVALID_OPTION');
  assert.equal((await students[0].emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: '1' })).ok, false);
  assert.equal((await host.emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 1 })).code, 'NOT_A_STUDENT');
  const outsider = await h.connect(await h.user('Outsider', 'student'));
  assert.equal((await outsider.emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 1 })).ok, false);
  assert.equal(dbCount(launch.mcqId), 0);
  await students[0].wait('mcq-ranking-ended');
});

test('A25. the state is recovered from the database if the server restarts mid-question', async () => {
  const { host, students, session } = await classroom(['Meena']);
  const launch = await host.emit('raise-mcq', Q());
  await students[0].emit('submit-mcq-answer', { mcqId: launch.mcqId, selectedOption: 1 });
  await h.manager.drop(session.sessionCode); // what a process restart does to the in-memory room
  const again = await h.connect(students[0].user);
  await again.join(session.sessionCode);
  const hostAgain = await h.connect(host.who);
  await hostAgain.join(session.sessionCode);
  const probe = await hostAgain.emit('get-mcq-state', {});
  assert.ok(['open', 'idle', 'ranking'].includes(probe.state));
  if (probe.state === 'open') assert.equal(probe.mcq.mcqId, launch.mcqId);
  const stored = h.models.LiveMcqResponse.docs.filter((d) => String(d.mcq) === launch.mcqId);
  assert.equal(stored.length, 1, 'the stored answer survived');
});
