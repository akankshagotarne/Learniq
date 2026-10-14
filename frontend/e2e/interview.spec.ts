/**
 * Teacher interview UI against the mocked API: the student card (locked / unlocked, directly under Start Exam), the waiting
 * room, and the teacher directory. Real camera / microphone / WebRTC cannot run in this headless mock - that part is covered
 * by the backend signalling tests and is stated as a limitation in the report.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockApi, type Override } from './mockApi';
import { findOverflow } from './layout';

const PHONE = { width: 360, height: 780 };
const iv = (status: string, extra: Record<string, unknown> = {}) => ({ _id: 'iv1', exam: 'oly-done', student: 'stu1', teacher: null, status, ...extra });

const studentOverride = (state: { status: string }): Override => (method, path) => {
  if (method === 'GET' && path === '/interviews/mine') {
    return { body: { success: true, requestsEnabled: true, byExam: {
      'oly-ready': { eligible: false, locked: true, code: 'EXAM_NOT_SUBMITTED', message: 'Submit your Olympiad exam to unlock the interview.', interview: null },
      'oly-done': { eligible: true, locked: false, code: null, message: null, interview: state.status === 'NONE' ? null : iv(state.status) },
    } } };
  }
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

  test('locked until the exam is submitted, then requestable, and the waiting room shows the backend status', async ({ page }) => {
    const state = { status: 'NONE' };
    await mockApi(page, 'student', studentOverride(state));
    await page.goto('/student/exams');

    const locked = page.getByTestId('interview-locked');
    await expect(locked).toBeVisible();
    await expect(locked).toBeDisabled();
    await expect(locked).toHaveText(/Start Interview — Locked/);
    await expect(page.getByText('Submit your Olympiad exam to unlock the interview.')).toBeVisible();

    // locked sits directly under the Start Exam button of the SAME card
    const card = page.getByTestId('olympiad-card').filter({ has: locked });
    const startExam = card.getByRole('link', { name: /Start Exam/ });
    const [a, b] = await Promise.all([startExam.boundingBox(), locked.boundingBox()]);
    expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1);
    expect(b!.y - (a!.y + a!.height)).toBeLessThan(24);

    // a payment-pending card (no payment yet) never offers the interview
    await expect(page.getByTestId('interview-action')).toHaveCount(1);

    // the submitted exam lives under "Completed": the interview is requestable there
    await page.getByRole('tab', { name: /Completed/ }).click();
    const start = page.getByTestId('interview-start');
    await expect(start).toBeEnabled();
    await start.click();
    await expect(page).toHaveURL(/\/student\/interview\/iv1$/);
    await expect(page.getByTestId('interview-status')).toHaveText('Waiting for Teacher');
    await noOverflow(page);

    // refresh keeps the state (it comes from the backend)
    await page.reload();
    await expect(page.getByTestId('interview-status')).toHaveText('Waiting for Teacher');
  });

  test('"Join Interview" appears only once a teacher has started it, then waits for approval', async ({ page }) => {
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
});

test.describe('teacher interview directory', () => {
  const row = (name: string, email: string | null, phone: string | null, status = 'NONE') => ({
    student: { _id: `s-${name}`, name, email, phone, standard: 9 }, standard: 9, exam: { _id: 'oly-done', title: 'Olympiad Std 9', standard: 9 },
    submission: { status: 'SUBMITTED', submittedAt: new Date().toISOString() }, interview: null, interviewStatus: status, assignedTeacher: null, assignedToMe: false,
  });

  test('lists submitted students with placeholders for missing contact and starts an interview', async ({ page }) => {
    await page.setViewportSize(PHONE);
    let started = false;
    await mockApi(page, 'teacher', (m, p) => {
      if (m === 'GET' && p === '/interviews/teacher/directory') {
        return { body: { success: true, myActive: null, counts: { pending: 1, waitingApproval: 0, assigned: 0, active: 0, completed: 0 },
          rows: [row('Asha Rao', 'asha@example.com', null, 'REQUESTED'), row('Ravi Kumar', null, '9876543210')] } };
      }
      if (m === 'POST' && p === '/interviews/teacher/start') { started = true; return { body: { success: true, interview: iv('ASSIGNED', { teacher: 't1' }) } }; }
      if (m === 'GET' && p === '/interviews/iv1') {
        return { body: { success: true, interview: iv('ASSIGNED', { teacher: 't1' }), role: 'teacher', student: { _id: 's1', name: 'Asha Rao', standard: 9 }, teacher: { _id: 't1', name: 'T' }, exam: { _id: 'oly-done', title: 'Olympiad', standard: 9 } } };
      }
      return undefined;
    });
    await page.goto('/teacher/interview');
    await expect(page.getByTestId('interview-row')).toHaveCount(2);
    await expect(page.getByText('Not provided').first()).toBeVisible();
    await noOverflow(page);
    await page.getByTestId('interview-start-row').first().click();
    await expect(page).toHaveURL(/\/teacher\/interview\/iv1$/);
    expect(started).toBe(true);
    await expect(page.getByTestId('interview-status')).toHaveText('Assigned');
  });
});
