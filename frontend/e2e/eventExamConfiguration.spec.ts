/**
 * Event-level Examination Configuration (Exam Only / Exam + Interview), UI side with a mocked API. The server rules (409 for Exam Only,
 * isolation, legacy behaviour, payments) are covered in backend/src/tests/eventInterviewConfig.test.js.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockApi, olympiadExams } from './mockApi';

const mkEvent = (over: any = {}) => ({
  _id: 'evA', name: 'LearnIQ Test 31 Oct', slug: 'a', reference: '', description: '', examDate: '2026-10-31T00:00:00.000Z', examDateIST: '31 Oct 2026', standards: [7, 8],
  state: 'published', status: 'registration_open', registration: 'open', startDate: '2026-10-31T03:30:00.000Z', endDate: '2026-10-31T15:30:00.000Z',
  startDateIST: '31 Oct 2026, 9:00 AM IST', endDateIST: '31 Oct 2026, 9:00 PM IST', registrationOpensAt: null, registrationClosesAt: null, registrationOpensAtIST: '', registrationClosesAtIST: '',
  examCount: 2, isLegacy: false, cancelReason: '', updatedAt: '2026-10-20T08:00:00.000Z', examFee: 10, students: 4, registrations: 4, submissions: 2, needsReview: 0,
  interviewEnabled: false, examinationMode: 'EXAM_ONLY', interviewFee: null, interviewOpensAt: null, interviewClosesAt: null, ...over,
});
const examOnly = mkEvent();
const withInterview = mkEvent({
  _id: 'evB', name: 'LearnIQ Test 24 Oct', interviewEnabled: true, examinationMode: 'EXAM_INTERVIEW', interviewFee: 10, examFee: 10, interviewEligible: 2,
  interviewOpensAt: '2026-11-01T03:30:00.000Z', interviewClosesAt: '2026-11-01T11:30:00.000Z', interviewOpensAtIST: '1 Nov 2026, 9:00 AM IST', interviewClosesAtIST: '1 Nov 2026, 5:00 PM IST',
});

async function setup(page: Page, handler?: (m: string, p: string, body: any) => any) {
  const calls: { m: string; p: string; body: any }[] = [];
  await mockApi(page, 'admin', (m, p) => {
    if (m === 'GET' && p === '/olympiad/admin/events') return { body: { success: true, events: [examOnly, withInterview] } };
    if (m === 'GET' && p === '/olympiad/admin/events/options') return { body: { success: true, options: [examOnly, withInterview].map(e => ({ _id: e._id, name: e.name, examDate: e.examDate, examDateIST: e.examDateIST, status: e.status, state: e.state, standards: e.standards, isLegacy: false, interviewEnabled: e.interviewEnabled })), defaultEventId: 'evA' } };
    if (m === 'GET' && p === '/olympiad/admin/events/evA') return { body: { success: true, event: examOnly, exams: [] } };
    if (m === 'GET' && p === '/olympiad/admin/events/evB') return { body: { success: true, event: withInterview, exams: [] } };
    return undefined;
  });
  await page.route('**/api/olympiad/admin/events**', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fallback();
    const url = new URL(req.url());
    const body = req.postDataJSON();
    calls.push({ m: req.method(), p: url.pathname.replace('/api', ''), body });
    const out = handler?.(req.method(), url.pathname.replace('/api', ''), body);
    if (out) return route.fulfill({ status: out.status ?? 200, contentType: 'application/json', body: JSON.stringify(out.body) });
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true, event: examOnly, changed: [] }) });
  });
  return calls;
}

test('admin event cards: mode badge, and interview details only for Exam + Interview events', async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/admin/olympiad/exam-management');
  const rows = page.getByTestId('event-row');
  await expect(rows).toHaveCount(2);
  const a = rows.filter({ hasText: 'LearnIQ Test 31 Oct' });
  const b = rows.filter({ hasText: 'LearnIQ Test 24 Oct' });
  await expect(a.getByTestId('event-mode')).toHaveText('EXAM ONLY');
  await expect(b.getByTestId('event-mode')).toHaveText('EXAM + INTERVIEW');
  await expect(a).not.toContainText('Interview');
  await expect(a).toContainText('Exam fee ₹10');
  await expect(b).toContainText('Interview eligible 2');
  await expect(b.getByTestId('event-interview-schedule')).toContainText('1 Nov 2026, 9:00 AM IST');
  await expect(b.getByTestId('event-fees')).toContainText('Interview ₹10');
  await expect(a.getByRole('button', { name: 'Edit' })).toBeVisible(); // existing actions are kept
  await expect(a.getByRole('button', { name: 'Manage Exams' })).toBeVisible();
});

test('create dialog: Exam Only is the default, interview fields appear only for Exam + Interview, and the payload follows the choice', async ({ page }) => {
  const calls = await setup(page);
  await page.goto('/admin/olympiad/exam-management');
  await page.getByTestId('create-event-btn').click();
  const cfg = page.getByTestId('exam-config');
  await expect(cfg).toContainText('Conduct an examination without an interview.');
  await expect(cfg).toContainText('Conduct an examination followed by an interview.');
  await expect(page.getByTestId('exam-config-exam-only')).toHaveAttribute('data-selected', 'true');
  await expect(page.getByTestId('interview-fields')).toHaveCount(0);
  await page.getByTestId('ev-name').fill('LearnIQ Olympiad Nov');
  await page.getByTestId('ev-std-8').check();
  await page.getByTestId('ev-start').fill('2026-11-10T09:00'); await page.getByTestId('ev-end').fill('2026-11-10T21:00');
  await page.getByTestId('ev-create').click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].body.interviewEnabled).toBe(false);
  expect(calls[0].body.interviewFee).toBeUndefined(); expect(calls[0].body.interviewOpensAt).toBeUndefined();

  await page.getByTestId('create-event-btn').click();
  await page.getByTestId('exam-config-exam-interview').click();
  await expect(page.getByTestId('exam-config-exam-interview')).toHaveAttribute('data-selected', 'true');
  await expect(page.getByTestId('interview-fields')).toBeVisible();
  await page.getByTestId('ev-name').fill('LearnIQ Olympiad Dec');
  await page.getByTestId('ev-std-8').check();
  await page.getByTestId('ev-start').fill('2026-12-10T09:00'); await page.getByTestId('ev-end').fill('2026-12-10T21:00');
  await page.getByTestId('ev-interview-fee-new').fill('15');
  await expect(page.getByTestId('fee-summary').first()).toContainText('Total ₹35');
  await page.getByTestId('ev-create').click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1].body.interviewEnabled).toBe(true); expect(calls[1].body.interviewFee).toBe(15);
});

test('edit dialog: shows the saved choice; switching a busy event asks for confirmation and only then sends confirmImpact', async ({ page }) => {
  let first = true;
  const calls = await setup(page, (m, p, body) => {
    if (m === 'PATCH' && p === '/olympiad/admin/events/evB' && body.interviewEnabled === false && !body.confirmImpact && first) {
      first = false;
      return { status: 409, body: { success: false, code: 'CONFIRMATION_REQUIRED', message: 'Students have already registered or paid for this event. Switching to Exam Only will hide the interview from them. Confirm to continue.', impact: { registrations: 3, payments: 3, submissions: 2 } } };
    }
    return { body: { success: true, event: withInterview, changed: ['interviewEnabled'] } };
  });
  await page.goto('/admin/olympiad/exam-management');
  const b = page.getByTestId('event-row').filter({ hasText: 'LearnIQ Test 24 Oct' });
  await b.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByTestId('exam-config-exam-interview')).toHaveAttribute('data-selected', 'true');
  await expect(page.getByTestId('ev-interview-fee')).toBeVisible();
  await page.getByTestId('exam-config-exam-only').click();
  await expect(page.getByTestId('ev-interview-fee')).toHaveCount(0); // hidden for Exam Only
  await page.getByRole('button', { name: /^Save/ }).click();
  await expect(page.getByTestId('impact-confirm')).toContainText('Registered students: 3');
  expect(calls.length).toBe(1); expect(calls[0].body.interviewEnabled).toBe(false); expect(calls[0].body.confirmImpact).toBeUndefined();
  await page.getByTestId('impact-confirm-btn').click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1].body.confirmImpact).toBe(true);
});

test('edit dialog: a blocked change keeps the saved choice and shows the server message', async ({ page }) => {
  await setup(page, () => ({ status: 409, body: { success: false, code: 'INTERVIEW_CHANGE_BLOCKED', message: 'This event already has paid or completed interview records, so it cannot be changed to Exam Only.' } }));
  await page.goto('/admin/olympiad/exam-management');
  await page.getByTestId('event-row').filter({ hasText: 'LearnIQ Test 24 Oct' }).getByRole('button', { name: 'Edit' }).click();
  await page.getByTestId('exam-config-exam-only').click();
  await page.getByRole('button', { name: /^Save/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'cannot be changed to Exam Only' })).toBeVisible();
  await expect(page.getByTestId('exam-config-exam-interview')).toHaveAttribute('data-selected', 'true');
});

test('phone layout: the configuration cards stack and nothing scrolls sideways', async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/admin/olympiad/exam-management');
  await page.getByTestId('create-event-btn').click();
  await expect(page.getByTestId('exam-config')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

// ───────────────────────── student side ─────────────────────────

const examCard = (over: any) => ({ ...olympiadExams[0], ...over });
const studentMocks = (exams: any[], mine: any = { success: true, byExam: {}, requestsEnabled: true }) => (m: string, p: string) => {
  if (m === 'GET' && p === '/olympiad/exams') return { body: { success: true, exams } };
  if (m === 'GET' && p === '/interviews/mine') return { body: mine };
  if (m === 'GET' && p === '/referrals/me/balance') return { body: { success: true, balance: 0 } };
  return undefined;
};

test('student: an Exam Only event shows only the exam: no interview card, fee, payment, Start Interview or badge', async ({ page }) => {
  await mockApi(page, 'student', studentMocks([
    examCard({ _id: 'oly-pay', state: 'pay', interviewIncluded: false, interviewUnlocked: false, prices: { EXAM: 10, currency: 'INR' } }),
    examCard({ _id: 'oly-sub', title: 'Submitted exam only', state: 'completed', paymentStatus: 'SUCCESS', attemptStatus: 'COMPLETED', interviewIncluded: false, interviewUnlocked: false, prices: { EXAM: 10, currency: 'INR' } }),
  ]));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/student/exams');
  await expect(page.getByTestId('olympiad-pair').first()).toBeVisible();
  await expect(page.getByTestId('interview-card')).toHaveCount(0);
  await expect(page.getByTestId('price-breakdown')).toHaveCount(0);
  await expect(page.getByTestId('interview-badge')).toHaveCount(0);
  await expect(page.getByText(/Start Interview|Unlock Interview|Interview Included|Pay for Interview/)).toHaveCount(0);
  await page.getByRole('tab', { name: /Completed/i }).click().catch(() => undefined);
  await expect(page.getByTestId('interview-card')).toHaveCount(0);
});

test('student: an Exam + Interview event shows "Interview Included", the interview fee and the payment status', async ({ page }) => {
  await mockApi(page, 'student', studentMocks([
    examCard({ _id: 'oly-pay', state: 'pay', interviewIncluded: true, interviewUnlocked: false, prices: { EXAM: 10, INTERVIEW: 25, currency: 'INR' } }),
  ]));
  await page.goto('/student/exams');
  const pair = page.getByTestId('olympiad-pair').first();
  await expect(pair.getByTestId('interview-card')).toBeVisible();
  await expect(pair.getByTestId('interview-included-line')).toContainText('Interview Included');
  await expect(pair.getByTestId('interview-included-line')).toContainText('₹25');
  await expect(pair.getByTestId('interview-payment-status')).toHaveText('Interview Payment Pending');
  await expect(pair.getByTestId('price-breakdown')).toContainText('Total ₹35');
});

test('student: the completion screen of an Exam Only event carries no interview text', async ({ page }) => {
  await mockApi(page, 'student', (m, p) => {
    if (m === 'GET' && /\/olympiad\/exams\/[^/]+\/result$/.test(p)) return { body: { success: true, result: { released: false }, completion: { submitted: true, submittedAt: new Date().toISOString(), interviewIncluded: false, interviewSelected: false, resultsReleased: false } } };
    return undefined;
  });
  await page.goto('/student/olympiad/oly-done/result');
  const screen = page.getByTestId('test-completion');
  await expect(screen).toContainText('Your Test Has Been Completed Successfully');
  await expect(screen).not.toContainText(/interview/i);
  await expect(page.getByTestId('completion-date')).toHaveCount(0);
});
