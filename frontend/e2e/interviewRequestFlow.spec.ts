/**
 * Student-initiated interview request lifecycle, UI side (mocked API). The teacher can never start an interview on her own:
 * - Not requested  -> "Waiting for Student Request" (no button, no write call)
 * - Requested      -> "Waiting for Approval" + "Accept Request"
 * - the STUDENT's "Start Interview" sends the request and then waits ("Waiting for Teacher Approval") until approval.
 * The backend rules themselves are covered in backend/src/tests/interviews.test.js; real media in e2e/real-media.
 */
import { test, expect } from '@playwright/test';
import { mockApi } from './mockApi';

const row = (name: string, status: string) => ({
  student: { _id: `s-${name}`, name }, standard: 9, exam: { _id: 'oly9', standard: 9 },
  submission: { status: 'SUBMITTED', submittedAt: '2026-10-11T15:30:00.000Z' }, interview: status === 'NONE' ? null : { _id: `iv-${name}`, status },
  interviewStatus: status, evaluation: null, assignedTeacher: null, assignedToMe: false,
});

test('teacher: a student who has not requested has NO start action; a requested one can be accepted', async ({ page }) => {
  const writes: string[] = [];
  await mockApi(page, 'teacher', (m, p) => {
    if (m !== 'GET') writes.push(`${m} ${p}`);
    if (m === 'GET' && p === '/interviews/teacher/directory') {
      return { body: { success: true, myActive: null, counts: { pending: 1, waitingApproval: 0, assigned: 0, active: 0, evaluationPending: 0, completed: 0 }, rows: [row('Nora', 'NONE'), row('Omar', 'REQUESTED'), row('Pia', 'CANCELLED')] } };
    }
    return undefined;
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/teacher/interview');
  const rows = page.locator('[data-testid="interview-row"]:visible');
  await expect(rows).toHaveCount(3);
  const nora = rows.filter({ hasText: 'Nora' });
  await expect(nora).toContainText('Not requested');
  await expect(nora.getByTestId('interview-waiting-student')).toHaveText('Waiting for Student Request');
  await expect(nora.getByRole('button', { name: /start|accept/i })).toHaveCount(0);
  await nora.getByTestId('interview-waiting-student').click({ force: true });
  await expect(rows.filter({ hasText: 'Pia' }).getByTestId('interview-waiting-student')).toBeVisible(); // cancelled: the student must ask again
  const omar = rows.filter({ hasText: 'Omar' });
  await expect(omar).toContainText('Waiting for Approval');
  await expect(omar.getByTestId('interview-accept')).toHaveText(/Accept Request/);
  await expect(page.getByRole('button', { name: /Start Interview/ })).toHaveCount(0);
  expect(writes, 'looking at the table never writes anything').toEqual([]);
});

test('student: Start Interview sends the request, shows Waiting for Teacher Approval, and moves on only after approval', async ({ page }) => {
  const state = { status: 'NONE' };
  const view = (status: string) => ({ _id: 'iv1', exam: 'oly9', student: 'stu1', teacher: status === 'APPROVED' ? 't1' : null, status, requestedBy: 'student' });
  await mockApi(page, 'student', (m, p) => {
    if (m === 'POST' && p === '/interviews/request') { state.status = 'REQUESTED'; return { status: 201, body: { success: true, created: true, interview: view('REQUESTED') } }; }
    if (m === 'GET' && p === '/interviews/iv1') {
      return { body: { success: true, interview: view(state.status), role: 'student', student: { _id: 'stu1', name: 'Student', standard: 9 }, teacher: state.status === 'APPROVED' ? { _id: 't1', name: 'Nikhil Sir' } : null, exam: { _id: 'oly9', title: 'Olympiad', standard: 9 } } };
    }
    return undefined;
  });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/student/interview/iv1'); // the page the Start Interview click navigates to
  state.status = 'REQUESTED';
  await page.reload();
  await expect(page.getByTestId('interview-status')).toHaveText('Waiting for Teacher Approval');
  await expect(page.getByText('Your interview request has been sent. Please wait for your teacher to approve it.')).toBeVisible();
  await expect(page.getByTestId('interview-room')).toHaveCount(0); // no media before approval
  await expect(page.getByTestId('interview-join')).toHaveCount(0);
  state.status = 'APPROVED'; // the teacher accepts: the waiting page picks it up by itself (push / polling)
  await expect(page.getByTestId('interview-status')).toHaveText('Request Approved', { timeout: 20000 });
});
