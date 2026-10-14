/**
 * BE Engineering mock test - browser behaviour (mocked API, like the other specs).
 * Student: the existing "Others" flow (card -> Request to Join -> pending / rejected / approved -> Start).
 * Admin: the Engineering section (requests, approve all with confirmation, results, attempt detail, PDF).
 * The server rules themselves (eligibility, deadline, ranking, PDF) are covered by backend/src/tests/engineering.test.js.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockApi, users, olympiadExams } from './mockApi';
import { findOverflow } from './layout';

const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const DEADLINE = '2026-10-14T12:30:00.000Z';

const engineeringExam = (over: Record<string, unknown> = {}) => ({
  ...olympiadExams[1], _id: 'eng-1', title: 'LearnIQ BE Engineering Mock Test 2026', slug: 'learniq-be-engineering-mock-test-2026', standard: 99,
  examType: 'engineering', category: 'BE Engineering', accessMode: 'approval', accessEnabled: true, hardClose: true, conductedBy: 'LearnIQ',
  fee: 0, totalQuestions: 40, totalMarks: 40, durationMinutes: 45, startDate: iso(NOW - 86400e3), endDate: DEADLINE,
  sections: [{ name: 'Programming Languages (Java, Python, C++)', questionCount: 10, marks: 10 }, { name: 'Operating Systems', questionCount: 5, marks: 5 }],
  instructions: ['The test has 40 multiple-choice questions and lasts 45 minutes.', 'Your camera must stay on.'],
  window: 'open', state: 'request', message: null, paymentStatus: 'NONE', attemptStatus: 'NOT_STARTED', result: null, remainingSeconds: null,
  access: { status: 'NONE' }, proctoring: { enabled: true, cameraRequired: true }, ...over,
});

const othersStudent = { ...users.student, currentStandard: 99 };

async function studentPage(page: Page, exam: Record<string, unknown>, sent: any[] = []) {
  await mockApi(page, 'student', (method, path) => {
    if (path === '/auth/me') return { body: { success: true, user: othersStudent } };
    if (path === '/olympiad/exams') return { body: { success: true, exams: [exam] } };
    if (path === '/olympiad/exams/eng-1' && method === 'GET') return { body: { success: true, exam } };
    if (path === '/engineering/request' && method === 'POST') return { status: 201, body: { success: true, request: { _id: 'r1', status: 'PENDING' } } };
    return undefined;
  });
  await page.route('**/api/engineering/request', async (route) => {
    if (route.request().method() === 'POST') { sent.push(route.request().postDataJSON()); }
    await route.fallback();
  });
}

for (const width of [390, 1280]) {
  test(`student (${width}px): the Others card shows FREE, the IST deadline and "Request to Join"; there is no Engineering menu item`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await studentPage(page, engineeringExam());
    await page.goto('/student/exams');
    const card = page.getByTestId('olympiad-card').filter({ hasText: 'BE Engineering Mock Test' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('BE Engineering');
    await expect(card).toContainText('FREE');
    await expect(card).toContainText('40 Questions');
    await expect(card).toContainText('40 Marks');
    await expect(card).toContainText('45 mins');
    await expect(card).toContainText('14 Oct 2026, 6:00 PM IST');
    await expect(card.getByTestId('engineering-request-link')).toContainText('Request to Join');
    expect(await page.locator('body').innerText()).not.toMatch(/Std\.?\s*99|Standard\s*99|₹/);
    if (width >= 1024) await expect(page.locator('nav, aside').getByText('Engineering', { exact: true })).toHaveCount(0);
    const r = await findOverflow(page);
    expect(r.offenders, JSON.stringify(r.offenders)).toEqual([]);
  });
}

test('student: Request to Join validates, sends ONLY the form fields (never name/e-mail/status), then shows Pending', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const sent: any[] = [];
  const exam = engineeringExam();
  await studentPage(page, exam, sent);
  await page.goto('/student/olympiad/eng-1');
  await expect(page.getByTestId('engineering-request-card')).toBeVisible();
  await expect(page.getByTestId('engineering-deadline')).toContainText('14 Oct 2026, 6:00 PM IST');
  await expect(page.getByText('FREE').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Start Examination/ })).toHaveCount(0);
  // the account's name / e-mail are shown read-only
  await expect(page.locator('input[readonly]').first()).toHaveValue(othersStudent.name);

  await page.getByRole('button', { name: 'Request to Join' }).click();
  await expect(page.getByText('Enter your college name.')).toBeVisible();
  await expect(page.getByText('Enter your branch or department.')).toBeVisible();
  await expect(page.getByText('Select your year of study.')).toBeVisible();
  expect(sent).toHaveLength(0);

  await page.locator('#eng-college').fill('Sinhgad Institute of Technology');
  await page.locator('#eng-branch').fill('Information Technology');
  await page.locator('#eng-year').selectOption('Fourth year');
  const pending = engineeringExam({ state: 'pending', access: { status: 'PENDING' } });
  await page.unroute('**/api/olympiad/exams/eng-1').catch(() => {});
  await page.route('**/api/olympiad/exams/eng-1', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, exam: pending }) }));
  await page.getByRole('button', { name: 'Request to Join' }).click();
  await expect(page.getByTestId('engineering-pending')).toBeVisible();
  expect(sent).toEqual([{ college: 'Sinhgad Institute of Technology', branch: 'Information Technology', degree: 'B.E.', year: 'Fourth year', rollNumber: '' }]);
  await expect(page.getByRole('button', { name: /Start Examination/ })).toHaveCount(0);
  const r = await findOverflow(page);
  expect(r.offenders, JSON.stringify(r.offenders)).toEqual([]);
});

test('student: rejected shows the reason and no Start; approved shows the agreement + Start', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await studentPage(page, engineeringExam({ state: 'rejected', message: 'Use your college e-mail.', access: { status: 'REJECTED', rejectionReason: 'Use your college e-mail.', canResubmit: false } }));
  await page.goto('/student/olympiad/eng-1');
  await expect(page.getByTestId('engineering-rejected')).toContainText('Use your college e-mail.');
  await expect(page.getByRole('button', { name: /Start Examination/ })).toHaveCount(0);
  await expect(page.getByTestId('engineering-request-card')).toHaveCount(0);

  await page.unroute('**/api/**');
  await studentPage(page, engineeringExam({ state: 'ready', access: { status: 'APPROVED' } }));
  await page.goto('/student/olympiad/eng-1');
  await expect(page.getByText(/Approved\./)).toBeVisible();
  const start = page.getByRole('button', { name: /Start Examination/ });
  await expect(start).toBeDisabled();
  await page.getByRole('checkbox').check();
  await expect(start).toBeEnabled();
});

test('student: a closed exam offers nothing to click', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await studentPage(page, engineeringExam({ state: 'closed', window: 'closed', message: 'The examination is closed.' }));
  await page.goto('/student/olympiad/eng-1');
  await expect(page.getByRole('button', { name: 'Exam Closed' })).toBeDisabled();
  await expect(page.getByTestId('engineering-request-card')).toHaveCount(0);
});

// ───────────────────────── admin ─────────────────────────
const summary = { totalRequests: 5, pending: 3, approved: 2, rejected: 0, started: 1, inProgress: 0, completed: 1, autoSubmitted: 0, notAttempted: 1, averageScore: 31, medianTimeSeconds: 1230, flaggedAttempts: 1 };
const req = (i: number, status = 'PENDING') => ({
  _id: `r${i}`, status, requestedAt: iso(NOW - i * 3600e3), reviewedAt: null, rejectionReason: null, canResubmit: false, studentId: `s${i}`,
  fullName: i === 1 ? 'Venkateshwaranathan Subramaniam Iyer-Chandrasekaran' : `Student ${i}`, email: `student${i}.with.a.long.address@example-college.edu.in`,
  college: 'Sinhgad Institute of Technology and Science, Lonavala', branch: 'Electronics & Telecommunication', degree: 'B.E.', year: 'Fourth year', rollNumber: '',
});
const row = {
  studentId: 's9', attemptId: 'att9', name: 'Student 9', email: 's9@example.com', college: 'COEP', branch: 'Computer', status: 'COMPLETED', rank: 1, score: 36, maxMarks: 40,
  percentage: 90, percentile: 75, timeTakenSeconds: 1500, startedAt: iso(NOW - 3600e3), submittedAt: iso(NOW - 2000e3), flagCount: 3, flagged: true, terminated: false, terminationReason: null,
};

async function adminPage(page: Page, calls: { method: string; path: string; body?: any }[]) {
  await mockApi(page, 'admin', (method, path) => {
    if (!path.startsWith('/engineering/')) return undefined;
    calls.push({ method, path });
    if (path === '/engineering/admin/overview') return { body: { success: true, summary, exam: { title: 'LearnIQ BE Engineering Mock Test 2026', endDateIST: '14 Oct 2026, 6:00 PM IST', durationMinutes: 45, isPublished: true, accessEnabled: true }, recentActivity: [{ action: 'REQUEST_APPROVED', at: iso(NOW), by: 'Admin Learniq', affected: 1, details: {} }] } };
    if (path === '/engineering/admin/requests' && method === 'GET') return { body: { success: true, counts: { total: 5, PENDING: 3, APPROVED: 2, REJECTED: 0 }, total: 3, page: 1, pages: 1, limit: 25, requests: [req(1), req(2), req(3)] } };
    if (path === '/engineering/admin/requests/approve-all') return { body: { success: true, approved: 3 } };
    if (path === '/engineering/admin/requests/r2/reject') return { body: { success: true, request: req(2, 'REJECTED') } };
    if (path === '/engineering/admin/results') return { body: { success: true, summary, rows: [row, { ...row, studentId: 's8', attemptId: null, name: 'Never Started', status: 'NOT_ATTEMPTED', rank: null, score: null, percentage: null, percentile: null, timeTakenSeconds: null, flagCount: 0, flagged: false }], total: 2, page: 1, pages: 1, limit: 25, totalCompleted: 1 } };
    if (path === '/engineering/admin/results/att9') return { body: { success: true, attempt: {
      attemptId: 'att9', status: 'COMPLETED', rank: 1, rankOf: 1, percentile: 75, student: { name: 'Student 9', email: 's9@example.com', college: 'COEP', branch: 'Computer', degree: 'B.E.', year: 'Fourth' },
      submissionType: 'MANUAL', startedAt: iso(NOW - 3600e3), deadline: iso(NOW), submittedAt: iso(NOW - 2000e3),
      result: { score: 36, maxMarks: 40, percentage: 90, correct: 36, incorrect: 3, unanswered: 1, timeTakenSeconds: 1500 },
      questions: Array.from({ length: 40 }, (_, i) => ({ questionNumber: i + 1, subject: 'Operating Systems', questionText: 'q', options: ['a', 'b', 'c', 'd'], selectedOption: i % 5 === 4 ? null : 1, correctOption: 1, status: i % 5 === 4 ? 'UNANSWERED' : 'CORRECT', marks: 1, marksAwarded: i % 5 === 4 ? 0 : 1 })),
      proctoring: { counts: {}, flagCount: 3, terminationReason: null, terminatedAt: null, consentAt: iso(NOW), events: [{ type: 'TAB_SWITCH', severity: 'warning', source: 'client', counted: true, warningNumber: 1, confidence: null, occurredAt: iso(NOW - 3000e3), durationMs: null }] },
      history: [{ action: 'REQUESTED', at: iso(NOW - 7200e3), reason: '' }],
    } } };
    if (path === '/engineering/admin/exam') return { body: { success: true, exam: { _id: 'eng-1', title: 'LearnIQ BE Engineering Mock Test 2026', slug: 's', category: 'BE Engineering', startDate: iso(NOW), endDate: DEADLINE, endDateIST: '14 Oct 2026, 6:00 PM IST', startDateIST: '', durationMinutes: 45, totalQuestions: 40, totalMarks: 40, marksPerCorrect: 1, negativeMarking: false, fee: 0, isPublished: true, accessEnabled: true, hardClose: true, instructions: [], questionCount: 40, ready: true, problems: [], windowState: 'open' } } };
    return undefined;
  });
  await page.route('**/api/engineering/admin/requests/approve-all', async (route) => { calls.push({ method: 'BODY', path: 'approve-all', body: route.request().postDataJSON() }); await route.fallback(); });
  await page.route('**/api/engineering/admin/requests/r2/reject', async (route) => { calls.push({ method: 'BODY', path: 'reject', body: route.request().postDataJSON() }); await route.fallback(); });
}

for (const width of [390, 1280]) {
  test(`admin (${width}px): Engineering is in the sidebar; overview, requests (approve all asks first), results and attempt detail work`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const calls: any[] = [];
    await adminPage(page, calls);
    await page.goto('/admin/engineering');
    await expect(page.getByRole('heading', { name: 'Engineering' })).toBeVisible();
    await expect(page.getByText('Closes 14 Oct 2026, 6:00 PM IST').first()).toBeVisible();
    await expect(page.getByText('Flagged attempts')).toBeVisible();
    if (width >= 1024) await expect(page.locator('aside, nav').getByRole('link', { name: 'Engineering' })).toBeVisible();

    await page.getByRole('tab', { name: 'Requests' }).click();
    await expect(page.getByText('Venkateshwaranathan Subramaniam Iyer-Chandrasekaran')).toBeVisible();
    let r = await findOverflow(page);
    expect(r.offenders, JSON.stringify(r.offenders)).toEqual([]);
    // approve all: nothing is sent until the dialog is confirmed, and the confirmation carries the exact count
    await page.getByTestId('approve-all').click();
    await expect(page.getByRole('dialog')).toContainText('approves 3 pending');
    expect(calls.some(c => c.path === '/engineering/admin/requests/approve-all')).toBe(false);
    await page.getByTestId('approve-all-confirm').click();
    await expect.poll(() => calls.find(c => c.method === 'BODY' && c.path === 'approve-all')?.body).toEqual({ confirm: true, expectedCount: 3 });
    // reject with a reason
    await page.locator('tr', { hasText: 'Student 2' }).getByRole('button', { name: 'Reject', exact: true }).click();
    await page.getByLabel(/Reason/).fill('Not a BE student');
    await page.getByRole('dialog').getByRole('button', { name: 'Reject', exact: true }).click();
    await expect.poll(() => calls.find(c => c.method === 'BODY' && c.path === 'reject')?.body).toEqual({ reason: 'Not a BE student' });

    await page.getByRole('tab', { name: 'Results' }).click();
    await expect(page.getByRole('button', { name: 'Student 9' })).toBeVisible();
    await expect(page.getByText('Never Started')).toBeVisible();
    await expect(page.getByTestId('download-report')).toBeVisible();
    r = await findOverflow(page);
    expect(r.offenders, JSON.stringify(r.offenders)).toEqual([]);
    await page.getByRole('button', { name: 'Student 9' }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg).toContainText('36/40');
    await expect(dlg).toContainText('Tab switch');
    await expect(dlg).toContainText('Question-wise marks');
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);

    await page.getByRole('tab', { name: 'Exam settings' }).click();
    await expect(page.locator('#deadline')).toHaveValue('2026-10-14T18:00'); // the deadline is edited in IST
  });
}

test('a student cannot open the admin Engineering page', async ({ page }) => {
  await studentPage(page, engineeringExam());
  await page.goto('/admin/engineering');
  await expect(page.getByRole('heading', { name: 'Engineering' })).toHaveCount(0);
});
