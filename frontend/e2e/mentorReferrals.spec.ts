/**
 * Mentor referral TRACKING UI (teacher page, admin tab, mentor link on the register page). Mocked API; the real rules
 * (attribution, status, privacy, "mentors never receive credits") are proven in backend/src/tests/mentorReferrals.test.js.
 */
import { test, expect } from '@playwright/test';
import { mockApi, type Override } from './mockApi';
import { findOverflow } from './layout';

const CODE = 'MNK7M2PXQ';
const rows = [
  { no: 2, name: 'Neeta K.', userType: 'Teacher', standard: null, registeredAt: '2026-10-20T08:00:00Z', status: 'Pending Approval', statusCode: 'PENDING', successfulAt: null },
  { no: 1, name: 'Kabir P.', userType: 'Student', standard: 9, registeredAt: '2026-10-18T08:00:00Z', status: 'Successful', statusCode: 'SUCCESSFUL', successfulAt: '2026-10-18T08:00:00Z' },
];
const teacherApi = (extra?: Override): Override => (m, p, body) => {
  const c = extra?.(m, p, body); if (c) return c;
  if (m === 'GET' && p === '/mentor-referrals/me') return { body: { success: true, code: CODE, link: `https://learniq.example.com/register?mentorRef=${CODE}`, stats: { totalReferrals: 2, successful: 1, pending: 1 } } };
  if (m === 'GET' && p === '/mentor-referrals/me/referrals') return { body: { success: true, page: 1, limit: 10, total: 2, referrals: rows } };
  return undefined;
};

test('teacher: sidebar item, code, link, counts, table without contact details, and nothing about credits', async ({ page }) => {
  await mockApi(page, 'teacher', teacherApi());
  await page.goto('/teacher');
  await page.getByRole('link', { name: 'Referrals' }).first().click();
  await expect(page).toHaveURL(/\/teacher\/referrals$/);
  await expect(page.getByRole('heading', { name: 'Mentor Referrals' })).toBeVisible();
  await expect(page.getByTestId('mentor-code')).toHaveText(CODE);
  await expect(page.getByTestId('mstat-total-value')).toHaveText('2');
  await expect(page.getByTestId('mstat-successful-value')).toHaveText('1');
  await expect(page.getByTestId('mstat-pending-value')).toHaveText('1');
  await expect(page.getByTestId('mentor-row')).toHaveCount(2); await expect(page.getByTestId('mentor-card')).toHaveCount(2);
  const text = await page.getByTestId('teacher-referrals').innerText();
  expect(text).not.toMatch(/\b(credits?|earn|earnings|earned|rewards?)\b|@|\+91/i);
  await expect(page.getByText('Pending Approval').first()).toBeVisible();
});

test('teacher: empty state, error state with retry', async ({ page }) => {
  let fail = true;
  await mockApi(page, 'teacher', teacherApi((m, p) => {
    if (m === 'GET' && p === '/mentor-referrals/me/referrals') return fail ? { status: 500, body: { success: false } } : { body: { success: true, page: 1, limit: 10, total: 0, referrals: [] } };
    return undefined;
  }));
  await page.goto('/teacher/referrals');
  await expect(page.getByTestId('error')).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Try again' }).first().click();
  await expect(page.getByTestId('mentor-empty')).toContainText('No referrals yet');
});

test('teacher: a student cannot open the page; the page is clean at phone width', async ({ page }) => {
  await mockApi(page, 'student');
  await page.goto('/teacher/referrals');
  await expect(page).not.toHaveURL(/\/teacher\/referrals/);
});
for (const w of [320, 390]) {
  test(`teacher: no horizontal overflow at ${w}px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 800 });
    await mockApi(page, 'teacher', teacherApi());
    await page.goto('/teacher/referrals');
    await expect(page.getByTestId('mentor-card').first()).toBeVisible();
    expect((await findOverflow(page)).offenders).toEqual([]);
  });
}

test('admin: Mentor Referrals tab keeps the old tabs, shows server-side data and details, no credit figures', async ({ page }) => {
  const asked: string[] = [];
  await mockApi(page, 'admin', (m, p, body) => {
    if (m === 'GET' && p === '/mentor-referrals/admin/overview') return { body: { success: true, metrics: { totalReferrals: 5, successful: 3, pending: 2, participatingMentors: 2, referredStudents: 3, referredTeachers: 2, teachersAwaitingApproval: 2 }, topMentors: [] } };
    if (m === 'GET' && p.startsWith('/mentor-referrals/admin/referrals/')) return { body: { success: true, referral: { id: 'r1', mentorId: 'm1', mentorName: 'Mentor Gauri', mentorCode: CODE, referredId: 'u1', referredName: 'Zed', referredRole: 'student', standard: 9, registeredAt: '2026-10-18T08:00:00Z', status: 'SUCCESSFUL', successfulAt: '2026-10-18T08:00:00Z', accountStatus: 'APPROVED', source: 'LINK', mentor: { id: 'm1', name: 'Mentor Gauri' }, referred: { id: 'u1', name: 'Zed' }, approvalStatus: null, reward: 'None. Mentor referrals never earn exam credits or money.', timeline: [{ at: '2026-10-18T08:00:00Z', event: 'REGISTERED', byName: null, reason: null }] } } };
    if (m === 'GET' && p.startsWith('/mentor-referrals/admin/referrals')) { asked.push(p); return { body: { success: true, page: 1, limit: 15, total: 1, referrals: [{ id: 'r1', mentorId: 'm1', mentorName: 'Mentor Gauri', mentorCode: CODE, referredId: 'u1', referredName: 'Zed', referredRole: 'student', standard: 9, registeredAt: '2026-10-18T08:00:00Z', status: 'SUCCESSFUL', successfulAt: '2026-10-18T08:00:00Z', accountStatus: 'APPROVED', source: 'LINK' }] } }; }
    return undefined;
  });
  await page.goto('/admin/refer-earn?tab=mentors');
  for (const t of ['overview', 'referrals', 'transactions', 'send', 'settings']) await expect(page.getByTestId(`tab-${t}`)).toBeVisible();
  await expect(page.getByTestId('mmetric-total-value')).toHaveText('5');
  await expect(page.getByTestId('mmetric-awaiting-value')).toHaveText('2');
  await expect(page.getByTestId('mm-row')).toHaveCount(1);
  expect(await page.getByTestId('admin-mentor-referrals').innerText()).not.toMatch(/credits (awarded|earned)/i);
  await page.getByTestId('mm-view').click();
  await expect(page.getByTestId('mentor-dialog')).toContainText('never earn');
});

test('register: a mentor link is validated, shown, and sent with the registration; an invalid one never blocks', async ({ page }) => {
  const sent: any[] = [];
  await mockApi(page, 'guest', (m, p, body) => {
    if (m === 'GET' && p === '/mentor-referrals/validate') return { body: { success: true, valid: true } };
    if (m === 'POST' && p === '/auth/register') { sent.push(body); return { status: 201, body: { success: true, token: 't', user: { _id: 'u1', name: 'Asha', role: 'student' } } }; }
    return undefined;
  });
  await page.goto(`/register?mentorRef=${CODE.toLowerCase()}`);
  await expect(page.getByTestId('mentor-ref-note')).toContainText('invited by a LearnIQ mentor');
  await page.locator('input[name="name"]').fill('Asha Patil');
  await page.locator('input[name="phone"]').fill('+91 98765 43210');
  await page.locator('input[name="password"]').fill('Str0ngPass1');
  await page.locator('input[name="confirmPassword"]').fill('Str0ngPass1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].mentorRef).toBe(CODE);
});
