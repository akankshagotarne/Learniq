/** Congratulation banner after submitting + admin schedule page (mocked API; the real rules are in backend/src/tests/interviewSchedule.test.js). */
import { test, expect } from '@playwright/test';
import { mockApi } from './mockApi';
import { findOverflow } from './layout';

const tomorrow = {
  summary: { scope: 'general', interviewDate: '2026-10-15', startTime: null, endTime: null, dayLabel: 'Thursday, 15 October 2026', timeLabel: null, teacherName: null, note: null },
  configured: true,
  headline: "Congratulations! You have successfully completed your test and are scheduled for tomorrow's interview.",
  detail: 'Please join on time. Your interview schedule and exact timing will be shared in your WhatsApp group.',
  when: 'Thursday, 15 October 2026',
};
const none = { summary: null, configured: false, headline: 'Congratulations! You have successfully completed your test.', detail: 'Your interview schedule and timing will be shared soon in your WhatsApp group.', when: null };
const mineWith = (schedule: unknown) => ({ success: true, requestsEnabled: true, byExam: { 'oly-done': { stage: 'AVAILABLE', workflowComplete: false, evaluation: null, eligible: true, locked: false, code: null, message: null, interview: null, schedule } } });

for (const [name, sched, headline, forbidden] of [
  ['schedule configured', tomorrow, tomorrow.headline, null],
  ['nothing configured', none, none.headline, /tomorrow|\d{1,2}:\d{2}\s?(am|pm)/i],
] as const) {
  test(`result page (${name}): shows the exact message, no layout overflow on a phone`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await mockApi(page, 'student', (m, p) => (m === 'GET' && p === '/interviews/mine' ? { body: mineWith(sched) } : undefined));
    await page.goto('/student/olympiad/oly-done/result');
    const banner = page.getByTestId('interview-schedule-banner');
    await expect(banner).toBeVisible();
    await expect(page.getByTestId('schedule-headline')).toHaveText(headline);
    await expect(page.getByTestId('schedule-detail')).toHaveText(sched.detail);
    if (forbidden) await expect(banner).not.toContainText(forbidden);
    expect((await findOverflow(page)).pageOverflowX).toBeFalsy();
  });
}

test('admin schedule page: reminders OFF is stated plainly; a schedule can be saved', async ({ page }) => {
  let saved: any = null;
  const data = { success: true, timezone: 'Asia/Kolkata', today: '2026-10-14', exams: [{ _id: 'e5', title: 'LearnIQ Practice Test – 5th Standard', standard: 5, schedule: null }], slots: [], submitted: [], teachers: [] };
  const rem = { success: true, automated: false, provider: { whatsappConfigured: false, smsConfigured: false, activeChannel: 'whatsapp', leadMinutes: 60, voiceCalls: false }, counts: { PENDING: 0, SENDING: 0, SENT: 0, FAILED: 0, CANCELLED: 0, EXPIRED: 0 }, attention: [] };
  await mockApi(page, 'admin', (m, p, body) => {
    if (m === 'GET' && p === '/interviews/admin/schedule') return { body: data };
    if (m === 'GET' && p === '/interviews/admin/reminders') return { body: rem };
    if (m === 'PUT' && p === '/interviews/admin/schedule') { saved = body; return { body: { success: true, updated: 1 } }; }
    return undefined;
  });
  await page.goto('/admin/interview-schedule');
  await expect(page.getByTestId('reminder-status')).toContainText('Automatic reminders are OFF');
  await expect(page.getByTestId('reminder-status')).toContainText('Voice-call reminders are not available');
  await page.getByTestId('std-5').check();
  await page.getByTestId('sched-date').fill('2026-10-15');
  await page.getByTestId('sched-save').click();
  await expect.poll(() => saved).toMatchObject({ examIds: ['e5'], interviewDate: '2026-10-15' });
});
