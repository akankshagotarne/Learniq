/**
 * Teacher interview UI against the mocked API: Exams-page tabs + the interview button, the waiting room, the teacher
 * directory (Accept Request), the evaluation form (mobile + desktop), the student's Interview Results and the admin page.
 * Real camera / microphone / WebRTC is covered separately by e2e/real-media (npm run test:e2e:media).
 */
import { test, expect, type Page } from '@playwright/test';
import { mockApi, type Override } from './mockApi';
import { findOverflow } from './layout';

const PHONE = { width: 360, height: 780 };
const iv = (status: string, extra: Record<string, unknown> = {}) => ({ _id: 'iv1', exam: 'oly-done', student: 'stu1', teacher: null, status, ...extra });
const stageFor = (status: string) => ({ NONE: 'AVAILABLE', REQUESTED: 'REQUESTED', APPROVED: 'IN_PROGRESS', IN_PROGRESS: 'IN_PROGRESS', EVALUATION_PENDING: 'EVALUATION_PENDING', COMPLETED: 'COMPLETED', CANCELLED: 'AVAILABLE', FAILED: 'AVAILABLE' } as Record<string, string>)[status];

const mine = (status: string) => ({
  success: true, requestsEnabled: true, byExam: {
    'oly-ready': { stage: 'LOCKED', workflowComplete: false, evaluation: null, eligible: false, locked: true, code: 'NOT_SUBMITTED', message: 'Submit your Olympiad exam to unlock the interview.', interview: null },
    'oly-done': {
      stage: stageFor(status), workflowComplete: status === 'COMPLETED', eligible: true, locked: false, code: null, message: null,
      evaluation: status === 'COMPLETED' ? { state: 'SUBMITTED', totalMarks: 40, maxMarks: 50, percentage: 80 } : null,
      interview: ['NONE', 'CANCELLED', 'FAILED'].includes(status) ? null : iv(status),
    },
  },
});

const studentOverride = (state: { status: string }): Override => (method, path) => {
  if (method === 'GET' && path === '/interviews/mine') return { body: mine(state.status) };
  if (method === 'POST' && path === '/interviews/request') { state.status = 'REQUESTED'; return { body: { success: true, interview: iv('REQUESTED') } }; }
  if (method === 'GET' && path === '/interviews/iv1') {
    return { body: { success: true, interview: iv(state.status), role: 'student', student: { _id: 'stu1', name: 'Student', standard: 9 }, teacher: null, exam: { _id: 'oly-done', title: 'Olympiad', standard: 9 } } };
  }
  return undefined;
};

async function noOverflow(page: Page) {
  const r = await findOverflow(page);
  expect(r.offenders, JSON.stringify(r.offenders)).toEqual([]);
}

test.describe('student interview', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize(PHONE); });

  test('locked until the exam is submitted; a submitted exam with a pending interview STAYS under Available and moves to Completed only when the interview is completed', async ({ page }) => {
    const state = { status: 'NONE' };
    await mockApi(page, 'student', studentOverride(state));
    await page.goto('/student/exams');

    // purchased, not submitted → locked, directly under Start Exam
    const locked = page.getByTestId('interview-locked');
    await expect(locked).toBeVisible(); await expect(locked).toBeDisabled();
    await expect(locked).toHaveText(/Start Interview — Locked/);
    await expect(page.getByText('Submit your Olympiad exam to unlock the interview.')).toBeVisible();
    const card = page.getByTestId('olympiad-card').filter({ has: locked });
    const [a, b] = await Promise.all([card.getByRole('link', { name: /Start Exam/ }).boundingBox(), locked.boundingBox()]);
    expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1); expect(b!.y - (a!.y + a!.height)).toBeLessThan(24);

    // submitted, interview not requested → AVAILABLE tab (not Completed), score kept, Start Interview shown
    const done = page.getByTestId('olympiad-card').filter({ has: page.getByTestId('interview-start') });
    await expect(done).toBeVisible();
    await expect(done.getByText(/Your score/)).toBeVisible();
    await expect(done.getByTestId('interview-badge')).toContainText('Interview Pending');
    await page.getByRole('tab', { name: /Completed/ }).click();
    await expect(page.getByTestId('interview-start')).toHaveCount(0);
    await page.getByRole('tab', { name: /Available/ }).click();

    // request → waiting room → still Available
    await page.getByTestId('interview-start').click();
    await expect(page).toHaveURL(/\/student\/interview\/iv1$/);
    await expect(page.getByTestId('interview-status')).toHaveText('Waiting for Teacher Approval');
    await noOverflow(page);
    await page.reload();
    await expect(page.getByTestId('interview-status')).toHaveText('Waiting for Teacher Approval');
    await page.goto('/student/exams');
    await expect(page.getByTestId('interview-view')).toContainText('Waiting for Teacher Approval');
    await page.getByRole('tab', { name: /Completed/ }).click();
    await expect(page.getByTestId('interview-view')).toHaveCount(0);

    // evaluation pending → still Available; completed → Completed tab with the interview marks
    state.status = 'EVALUATION_PENDING';
    await page.reload();
    await expect(page.getByRole('tab', { name: /Available/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('interview-view')).toContainText('Evaluation Pending');
    state.status = 'COMPLETED';
    await page.reload();
    await page.getByRole('tab', { name: /Completed/ }).click();
    await expect(page.getByTestId('interview-marks')).toContainText('40/50 (80%)');
    await expect(page.getByTestId('interview-results-link')).toBeVisible();
    await page.getByRole('tab', { name: /Available/ }).click();
    await expect(page.getByTestId('interview-results-link')).toHaveCount(0);
  });

  test('a cancelled or failed interview is NOT treated as completed: the student can request again', async ({ page }) => {
    for (const status of ['CANCELLED', 'FAILED']) {
      const state = { status };
      await mockApi(page, 'student', studentOverride(state));
      await page.goto('/student/exams');
      await expect(page.getByTestId('interview-start')).toBeVisible();
      await page.getByRole('tab', { name: /Completed/ }).click();
      await expect(page.getByTestId('interview-start')).toHaveCount(0);
      await page.unroute('**/api/**');
    }
  });

  test('"Join Interview" appears only for an admin-assigned student request, then waits for approval', async ({ page }) => {
    const state = { status: 'ASSIGNED' };
    const base = studentOverride(state);
    await mockApi(page, 'student', (m, p) => {
      if (m === 'POST' && p === '/interviews/iv1/join-request') { state.status = 'WAITING_FOR_APPROVAL'; return { body: { success: true, interview: iv('WAITING_FOR_APPROVAL') } }; }
      return base(m, p);
    });
    await page.goto('/student/interview/iv1');
    await expect(page.getByTestId('interview-status')).toHaveText('Teacher Starting Interview');
    await page.getByTestId('interview-join').click();
    await expect(page.getByTestId('interview-status')).toHaveText('Waiting for Teacher Approval');
    await expect(page.getByTestId('interview-room')).toHaveCount(0); // no media before the teacher approves
  });

  test('Interview Results: shows only final marks and feedback; readable on a phone; an empty state when none', async ({ page }) => {
    const result = {
      interviewId: 'iv1', student: { name: 'Student', standard: 9 }, exam: { _id: 'oly-done', title: 'LearnIQ – All India Olympiad Examination 2026', standard: 9 }, teacher: { name: 'Nikhil Sir' },
      interviewDate: new Date().toISOString(), state: 'SUBMITTED', totalMarks: 40, maxMarks: 50, percentage: 80,
      scores: [['communication', 'Communication Skills', 8], ['confidence', 'Confidence and Self-Presentation', 9], ['subjectKnowledge', 'Subject Knowledge and Understanding', 7], ['listening', 'Listening Skills and Comprehension', 8], ['logicalThinking', 'Logical Thinking and Problem-Solving', 8]].map(([key, label, score]) => ({ key, label, max: 10, score })),
      remarks: 'Confident and clear.', strengths: 'Vocabulary', improvements: 'Speak slower', submittedAt: new Date().toISOString(), updatedAt: null,
    };
    let data: any = { success: true, results: [result], pending: [], criteria: [], maxMarks: 50 };
    await mockApi(page, 'student', (m, p) => (m === 'GET' && p === '/interviews/results' ? { body: data } : undefined));
    await page.goto('/student/interview-results');
    await expect(page.getByTestId('interview-result')).toBeVisible();
    await expect(page.getByTestId('result-total')).toContainText('40/50'); await expect(page.getByTestId('result-total')).toContainText('80%');
    await expect(page.getByText('Communication Skills')).toBeVisible(); await expect(page.getByText('Speak slower')).toBeVisible();
    await noOverflow(page);
    data = { success: true, results: [], pending: [{ interviewId: 'iv2', exam: { title: 'Olympiad' }, message: 'Your interview evaluation has not been submitted yet.' }], criteria: [], maxMarks: 50 };
    await page.reload();
    await expect(page.getByTestId('evaluation-pending')).toContainText('has not been submitted yet');
    data = { success: true, results: [], pending: [], criteria: [], maxMarks: 50 };
    await page.reload();
    await expect(page.getByTestId('no-results')).toContainText('No interview results are available yet.');
  });
});

const CRITERIA = [
  { key: 'communication', label: 'Communication Skills', description: 'Speaks clearly.', max: 10 },
  { key: 'confidence', label: 'Confidence and Self-Presentation', description: 'Stays calm.', max: 10 },
  { key: 'subjectKnowledge', label: 'Subject Knowledge and Understanding', description: 'Knows concepts.', max: 10 },
  { key: 'listening', label: 'Listening Skills and Comprehension', description: 'Listens.', max: 10 },
  { key: 'logicalThinking', label: 'Logical Thinking and Problem-Solving', description: 'Reasons.', max: 10 },
];

test.describe('teacher interview directory and evaluation', () => {
  // the table payload carries NO contact details (they are served only by /teacher/student-details)
  const row = (name: string, _email: string | null, _phone: string | null, status = 'NONE', extra: Record<string, unknown> = {}) => ({
    student: { _id: `s-${name}`, name }, standard: 9, exam: { _id: 'oly-done', standard: 9 },
    submission: { status: 'SUBMITTED', submittedAt: new Date().toISOString() }, interview: status === 'NONE' ? null : { _id: 'iv1', status },
    interviewStatus: status, evaluation: null, assignedTeacher: null, assignedToMe: false, ...extra,
  });

  test('lists submitted students (no contact details), Accept Request for a waiting student, and works on a phone', async ({ page }) => {
    await page.setViewportSize(PHONE);
    let accepted = false;
    await mockApi(page, 'teacher', (m, p) => {
      if (m === 'GET' && p === '/interviews/teacher/directory') {
        return { body: { success: true, myActive: null, counts: { pending: 1, waitingApproval: 0, assigned: 0, active: 0, evaluationPending: 0, completed: 0 },
          rows: [row('Asha Rao', 'asha@example.com', null, 'REQUESTED'), row('Ravi Kumar', null, '9876543210')] } };
      }
      if (m === 'POST' && p === '/interviews/iv1/accept') { accepted = true; return { body: { success: true, interview: iv('APPROVED', { teacher: 't1' }) } }; }
      if (m === 'GET' && p === '/interviews/iv1') {
        return { body: { success: true, interview: iv('ASSIGNED', { teacher: 't1' }), role: 'teacher', student: { _id: 's1', name: 'Asha Rao', standard: 9 }, teacher: { _id: 't1', name: 'T' }, exam: { _id: 'oly-done', title: 'Olympiad', standard: 9 } } };
      }
      return undefined;
    });
    await page.goto('/teacher/interview');
    await expect(page.locator('[data-testid="interview-row"]:visible')).toHaveCount(2); // phone: cards
    await expect(page.locator('body')).not.toContainText('@');
    await noOverflow(page);
    await page.locator('[data-testid="interview-accept"]:visible').click();
    await expect(page).toHaveURL(/\/teacher\/interview\/iv1$/);
    expect(accepted).toBe(true);
  });

  for (const vp of [{ width: 360, height: 780 }, { width: 1280, height: 800 }]) {
    test(`evaluation form @${vp.width}: live total, validation, preview, confirmation, no total sent, no overflow, draft kept on a failed submit`, async ({ page }) => {
      await page.setViewportSize(vp);
      let status = 'EVALUATION_PENDING'; let draft: any = null; let submitCalls = 0; let submitBody: any = null; let failFirst = true;
      await mockApi(page, 'teacher', (m, p) => {
        if (m === 'GET' && p === '/interviews/iv1') {
          return { body: { success: true, interview: iv(status, { teacher: 't1' }), role: 'teacher', student: { _id: 's1', name: 'Tushar', standard: 10 }, teacher: { _id: 't1', name: 'Nikhil Sir' }, exam: { _id: 'oly-done', title: 'Olympiad', standard: 10 } } };
        }
        if (m === 'GET' && p === '/interviews/iv1/evaluation') {
          const final = status === 'COMPLETED' ? { state: 'SUBMITTED', scores: CRITERIA.map((c, i) => ({ key: c.key, label: c.label, max: 10, score: [8, 9, 7, 8, 8][i] })), totalMarks: 40, maxMarks: 50, percentage: 80, remarks: '', strengths: '', improvements: '' } : draft;
          return { body: { success: true, criteria: CRITERIA, maxMarks: 50, interviewStatus: status, evaluation: final } };
        }
        if (m === 'PUT' && p === '/interviews/iv1/evaluation') { draft = { state: 'DRAFT', scores: [], totalMarks: 0, maxMarks: 50, percentage: 0, remarks: '', strengths: '', improvements: '' }; return { body: { success: true, evaluation: draft } }; }
        if (m === 'POST' && p === '/interviews/iv1/evaluation/submit') {
          submitCalls += 1;
          if (failFirst) { failFirst = false; return { status: 500, body: { success: false, message: 'Something went wrong. Please try again.' } }; }
          status = 'COMPLETED';
          return { body: { success: true, interview: iv('COMPLETED'), evaluation: { state: 'SUBMITTED' }, alreadySubmitted: false } };
        }
        return undefined;
      });
      page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/interviews/iv1/evaluation/submit')) submitBody = r.postDataJSON(); });
      await page.goto('/teacher/interview/iv1');
      const form = page.getByTestId('evaluation-form');
      await expect(form).toBeVisible();
      await expect(form.getByText('Tushar')).toBeVisible();
      await expect(page.getByTestId('eval-total')).toHaveText('0 / 50');
      await noOverflow(page);

      // incomplete → cannot submit, clear message, nothing sent
      await page.getByTestId('submit-eval').click();
      await expect(page.getByText('Please choose a score from 0 to 10.').first()).toBeVisible();
      expect(submitCalls).toBe(0);

      const pick = async (key: string, n: number) => { const b = page.getByTestId(`score-${key}-${n}`); await b.scrollIntoViewIfNeeded(); const box = await b.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(40); await b.click(); };
      await pick('communication', 8); await expect(page.getByTestId('eval-total')).toHaveText('8 / 50');
      await pick('confidence', 9); await pick('subjectKnowledge', 7); await pick('listening', 8); await pick('logicalThinking', 8);
      await expect(page.getByTestId('eval-total')).toHaveText('40 / 50'); await expect(page.getByTestId('eval-percentage')).toHaveText('80%');
      await page.getByLabel(/Teacher's Remarks/).fill('Confident and clear.');
      await noOverflow(page);

      await page.getByTestId('save-draft').click();
      await expect(page.getByText('Draft saved.').first()).toBeVisible();
      await page.getByTestId('preview-eval').click();
      await expect(page.getByTestId('eval-preview')).toContainText('40/50');

      // confirmation dialog, then a failing network call keeps every mark on screen
      await page.getByTestId('submit-eval').click();
      await expect(page.getByRole('dialog')).toContainText('Submit interview evaluation?');
      await expect(page.getByRole('dialog')).toContainText('After submission, the interview will be marked completed');
      await page.getByTestId('go-back-review').click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByTestId('submit-eval').click();
      await page.getByTestId('confirm-submit').click();
      await expect(page.getByText(/your marks are still here/i).first()).toBeVisible();
      await expect(page.getByTestId('eval-total')).toHaveText('40 / 50');
      expect(submitCalls).toBe(1);

      // retry succeeds; the payload carries scores only (the server computes totals)
      await page.getByTestId('submit-eval').click();
      await page.getByTestId('confirm-submit').dblclick();
      await expect(page.getByText(/locked/)).toBeVisible();
      expect(submitCalls).toBe(2);
      expect(submitBody.scores).toEqual({ communication: 8, confidence: 9, subjectKnowledge: 7, listening: 8, logicalThinking: 8 });
      expect(Object.keys(submitBody).sort()).toEqual(['improvements', 'remarks', 'scores', 'strengths']);
      await noOverflow(page);
    });
  }
});

test.describe('admin interview management', () => {
  const adminRow = (id: string, status: string, ev: any = null) => ({
    _id: id, student: { _id: 's' + id, name: 'Tushar ' + id, email: 'tushar@example.com', phone: null }, standard: 10, exam: { _id: 'e', title: 'LearnIQ – All India Olympiad Examination 2026' },
    submissionStatus: 'SUBMITTED', paymentStatus: 'SUCCESS', teacher: { _id: 't1', name: 'Nikhil Sir' }, status, requestedAt: new Date().toISOString(), startedAt: null, endedAt: null,
    durationSeconds: 0, endReason: null, endedBy: null, teacherPresent: false, studentPresent: false, stale: false, evaluation: ev,
  });
  for (const vp of [{ width: 360, height: 780 }, { width: 1280, height: 800 }]) {
    test(`lists sessions with marks and opens the evaluation @${vp.width}`, async ({ page }) => {
      await page.setViewportSize(vp);
      const ev = { state: 'SUBMITTED', scores: { communication: 8, confidence: 9, subjectKnowledge: 7, listening: 8, logicalThinking: 8 }, totalMarks: 40, maxMarks: 50, percentage: 80, submittedAt: new Date().toISOString() };
      await mockApi(page, 'admin', (m, p) => {
        if (m === 'GET' && p === '/interviews/admin/stats') return { body: { success: true, stats: { eligibleStudents: 3, notRequested: 1, pending: 0, assigned: 0, waitingApproval: 0, active: 0, evaluationPending: 1, completed: 1, cancelled: 0, failed: 0, stale: 0, teachersTotal: 2, teachersAvailable: 1, settings: { requestsEnabled: true } }, teachers: [{ _id: 't1', name: 'Nikhil Sir', email: 'n@x.com', available: true, current: null, completed: 1 }] } };
        if (m === 'GET' && p === '/interviews/admin/list') return { body: { success: true, interviews: [adminRow('1', 'COMPLETED', ev), adminRow('2', 'EVALUATION_PENDING')] } };
        if (m === 'GET' && p === '/interviews/admin/1') return { body: { success: true, interview: { _id: '1', status: 'COMPLETED', audit: [{ at: new Date().toISOString(), role: 'teacher', action: 'EVALUATION_SUBMITTED', note: null }], stale: false,
          evaluation: { state: 'SUBMITTED', totalMarks: 40, maxMarks: 50, percentage: 80, remarks: 'Confident', strengths: 'Vocabulary', improvements: 'Pace', submittedAt: ev.submittedAt, updatedAt: null, revisions: [],
            scores: [['communication', 'Communication Skills', 8], ['confidence', 'Confidence and Self-Presentation', 9], ['subjectKnowledge', 'Subject Knowledge and Understanding', 7], ['listening', 'Listening Skills and Comprehension', 8], ['logicalThinking', 'Logical Thinking and Problem-Solving', 8]].map(([key, label, score]) => ({ key, label, max: 10, score })) } } } };
        return undefined;
      });
      await page.goto('/admin/interviews');
      await expect(page.getByTestId('interview-stats')).toContainText('Evaluation pending');
      await expect(page.locator('[data-testid="admin-interview-row"]:visible')).toHaveCount(2);
      await expect(page.getByText('40/50 (80%)').filter({ visible: true }).first()).toBeVisible();
      await noOverflow(page);
      await page.getByRole('button', { name: 'Tushar 1' }).filter({ visible: true }).first().click();
      await expect(page.getByTestId('admin-evaluation')).toContainText('Total 40/50');
      await expect(page.getByTestId('admin-evaluation')).toContainText('Confident');
      await expect(page.getByTestId('apply-correction')).toBeHidden(); // collapsed until opened; needs a reason
      await page.getByRole('button', { name: 'Close' }).click();
      await page.getByRole('tab', { name: /Pending evaluations/ }).click();
      await expect(page.getByRole('tab', { name: /Pending evaluations/ })).toHaveAttribute('aria-selected', 'true');
    });
  }
});

test.describe('interview day (18 October 2026)', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize(PHONE); });
  const withOpen = (open: boolean): Override => (method, path) => {
    if (method === 'GET' && path === '/interviews/mine') {
      const m = mine('NONE'); (m.byExam['oly-done'] as Record<string, unknown>).interviewOpen = open; (m.byExam['oly-done'] as Record<string, unknown>).interviewOpensOn = '18 October 2026';
      return { body: m };
    }
    return undefined;
  };

  test('before the interview day: congratulations message + disabled "Scheduled — 18 October 2026", no way to request', async ({ page }) => {
    await mockApi(page, 'student', withOpen(false));
    await page.goto('/student/exams');
    await expect(page.getByTestId('interview-scheduled-note')).toHaveText('Congratulations! You have successfully completed your test. Your teacher interview is scheduled for 18 October 2026. Please check your WhatsApp group for your assigned interview time and join on time.');
    const b = page.getByTestId('interview-scheduled');
    await expect(b).toBeDisabled(); await expect(b).toContainText('Scheduled — 18 October 2026');
    await expect(page.getByTestId('interview-start')).toHaveCount(0);
    await noOverflow(page);
  });

  test('on the interview day: Start Interview is enabled', async ({ page }) => {
    await mockApi(page, 'student', withOpen(true));
    await page.goto('/student/exams');
    await expect(page.getByTestId('interview-start')).toBeEnabled();
    await expect(page.getByTestId('interview-scheduled')).toHaveCount(0);
  });
});
