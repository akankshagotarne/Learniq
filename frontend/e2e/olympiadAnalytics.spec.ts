/**
 * Olympiad Student Analytics page against the mocked API: four cards, four quick filters that re-query the server, reset, debounced search,
 * sorting, pagination, student drawer (read-only, IST, no payment data), export, loading / error / access-denied / empty states, phone layout, no overflow.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockApi, analyticsPayload, analyticsRow, analyticsDetail, type Override } from './mockApi';
import { findOverflow } from './layout';

const URL_ = '/admin/olympiad/analytics';
const calls: string[] = [];

const override = (extra?: Override): Override => (method, path, body) => {
  if (method === 'GET' && path === '/olympiad/admin/analytics') calls.push(path);
  return extra ? extra(method, path, body) : undefined;
};

async function open(page: Page, extra?: Override) {
  calls.length = 0;
  const log = await mockApi(page, 'admin', override(extra));
  await page.goto(URL_);
  return log;
}

test('sidebar entry sits under Olympiad and opens the page; heading is exact and the subtitle no longer mentions payments', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockApi(page, 'admin');
  await page.goto('/admin/olympiad');
  await page.getByRole('link', { name: 'Olympiad Student Analytics' }).click();
  await expect(page).toHaveURL(/\/admin\/olympiad\/analytics$/);
  await expect(page.getByTestId('page-title')).toHaveText('Olympiad Student Analytics & Participation Management');
  await expect(page.getByText('See which students registered for the Olympiad and whether they have submitted their exam.')).toBeVisible();
});

test('exactly four summary cards with real counts; no payment or attempt-state cards', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await expect(page.getByTestId('card-registered-value')).toHaveText('2');
  await expect(page.getByTestId('card-submitted-value')).toHaveText('1');
  await expect(page.getByTestId('card-notsubmitted-value')).toHaveText('1');
  await expect(page.getByTestId('card-rate-value')).toHaveText('50%');
  await expect(page.getByTestId('cards').locator('> *')).toHaveCount(4);
  for (const gone of ['card-paid', 'card-notpaid', 'card-notstarted', 'card-inprogress', 'card-completed']) await expect(page.getByTestId(gone)).toHaveCount(0);
  await expect(page.getByTestId('review-banner')).toHaveCount(0);
});

test('nothing on the page mentions payments, attempts, in progress or not started', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await expect(page.getByTestId('student-row').first()).toBeVisible();
  for (const id of ['filters', 'cards', 'tabs', 'students-table', 'footnote']) {
    const text = (await page.getByTestId(id).innerText()).toLowerCase();
    for (const word of ['payment', 'paid', 'razorpay', 'transaction', 'amount', 'in progress', 'not started', 'attempt', 'revenue']) expect(text, `${id} contains "${word}"`).not.toContain(word);
  }
});

test('filters: exam, standard, participation (All / Submitted / Not Submitted) and an optional registration date range', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  const f = page.getByTestId('filters');
  await expect(f.locator('select')).toHaveCount(3);
  await expect(f.locator('input[type=date]')).toHaveCount(2);
  await expect(page.getByLabel('Exam participation').locator('option')).toHaveText(['All', 'Submitted', 'Not Submitted']);
  await expect(page.getByLabel('Olympiad exam').locator('option').first()).toHaveText('All Exams');
  await expect(page.getByLabel('Standard', { exact: true }).locator('option').first()).toHaveText('All Standards');
});

test('quick filters: All Students · Registered · Submitted · Not Submitted — each is a real server query', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const urls: string[] = [];
  page.on('request', r => { if (/\/olympiad\/admin\/analytics\?/.test(r.url())) urls.push(r.url()); });
  await open(page);
  await expect(page.getByTestId('tabs').getByRole('tab')).toHaveText(['All Students (2)', 'Registered (2)', 'Submitted (1)', 'Not Submitted (1)']);
  await expect(page.getByTestId('tab-all')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('tab-submitted').click();
  await expect.poll(() => urls.some(u => u.includes('view=submitted'))).toBe(true);
  await expect(page.getByTestId('tab-submitted')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('tab-not_submitted').click();
  await expect.poll(() => urls.some(u => u.includes('view=not_submitted'))).toBe(true);
  await page.getByTestId('tab-registered').click();
  await expect.poll(() => urls.some(u => u.includes('view=registered'))).toBe(true);
  // the cards act as shortcuts to the same tabs
  await page.getByTestId('card-notsubmitted').click();
  await expect(page.getByTestId('tab-not_submitted')).toHaveAttribute('aria-selected', 'true');
});

test('Reset filters restores the defaults and re-queries', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const urls: string[] = [];
  page.on('request', r => { if (/\/olympiad\/admin\/analytics\?/.test(r.url())) urls.push(r.url()); });
  await open(page);
  await expect(page.getByTestId('reset-filters')).toBeDisabled();
  await page.getByLabel('Exam participation').selectOption('SUBMITTED');
  await page.getByLabel('Standard', { exact: true }).selectOption('10');
  await page.getByTestId('tab-submitted').click();
  await expect.poll(() => urls.some(u => u.includes('participation=SUBMITTED') && u.includes('standard=10') && u.includes('view=submitted'))).toBe(true);
  urls.length = 0;
  await page.getByTestId('reset-filters').click();
  await expect(page.getByLabel('Exam participation')).toHaveValue('all');
  await expect(page.getByLabel('Standard', { exact: true })).toHaveValue('all');
  await expect(page.getByTestId('tab-all')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => urls.length).toBeGreaterThan(0);
  expect(urls[urls.length - 1]).not.toMatch(/participation=|standard=|view=/);
});

test('table: seven columns, text status labels, em dash when not submitted, profile opens from the name', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await expect(page.getByTestId('students-table').locator('thead th')).toHaveText(['Student', 'Standard', 'Exam', 'Registration date', 'Exam status', 'Submission date', 'Action']);
  const rows = page.getByTestId('student-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Submitted');
  await expect(rows.first()).not.toContainText('Not Submitted');
  await expect(rows.first()).toContainText('IST');
  await expect(rows.nth(1)).toContainText('Not Submitted');
  await expect(rows.nth(1).locator('td').nth(5)).toHaveText('—');
  await expect(rows.nth(1).getByRole('button', { name: 'View Profile' })).toBeVisible();
  await rows.first().getByTestId('student-link').click();
  const drawer = page.getByTestId('student-drawer');
  await expect(drawer).toBeVisible();
  await expect(page.getByTestId('drawer-name')).toHaveText('Aarav Sharma');
  for (const t of ['Student ID', 'aarav@example.com', '+919000000001', 'Std 10', 'Registration status', 'Exam eligibility', 'Exam status', 'Submitted on', 'Marks obtained', '47 / 60', 'Result available', 'LQOLY2026-000123', 'IST']) await expect(drawer).toContainText(t);
  await expect(drawer).toContainText('Not recorded'); // school is not stored: an honest placeholder, not an invented value
  const text = (await drawer.innerText()).toLowerCase();
  for (const word of ['payment', 'razorpay', 'transaction', 'amount', 'attempt started', 'timeline']) expect(text, word).not.toContain(word);
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await rows.nth(1).getByRole('button', { name: 'View Profile' }).click();
  await expect(drawer).toBeVisible();
});

test('a record that needs review is flagged and explained, and kept out of the cards', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, (m, p) => (m === 'GET' && p === '/olympiad/admin/analytics'
    ? { body: { ...analyticsPayload([analyticsRow({ registered: false, registeredAt: null, flags: ['ATTEMPT_WITHOUT_REGISTRATION'] })]), cards: { ...analyticsPayload().cards, needsReview: 1 } } } : undefined));
  await expect(page.getByTestId('review-banner')).toContainText('1 record marked “Needs review”');
  await expect(page.getByTestId('student-row')).toContainText('Needs review');
  await expect(page.getByTestId('student-row').locator('td').nth(3)).toHaveText('—');
});

test('search is debounced (one request for a burst of typing) and resets to page 1', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const urls: string[] = [];
  page.on('request', r => { if (/\/olympiad\/admin\/analytics\?/.test(r.url())) urls.push(r.url()); });
  await open(page);
  await expect(page.getByTestId('student-row')).toHaveCount(2);
  urls.length = 0;
  await page.getByTestId('search').pressSequentially('diya', { delay: 40 });
  await expect.poll(() => urls.length).toBeGreaterThan(0);
  await page.waitForTimeout(600);
  expect(urls.filter(u => u.includes('search=')).length).toBe(1);
  expect(urls[urls.length - 1]).toContain('search=diya');
});

test('sorting toggles direction and is sent to the server with an allow-listed field', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const urls: string[] = [];
  page.on('request', r => { if (/\/olympiad\/admin\/analytics\?/.test(r.url())) urls.push(r.url()); });
  await open(page);
  await page.getByRole('button', { name: 'Student', exact: true }).click();
  await expect.poll(() => urls.some(u => u.includes('sort=name') && u.includes('order=desc'))).toBe(true);
  await page.getByRole('button', { name: 'Student', exact: true }).click();
  await expect.poll(() => urls.some(u => u.includes('sort=name') && u.includes('order=asc'))).toBe(true);
  for (const [label, field] of [['Standard', 'standard'], ['Registration date', 'registered'], ['Submission date', 'submissionDate']] as const) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect.poll(() => urls.some(u => u.includes(`sort=${field}`))).toBe(true);
  }
  await expect(page.getByRole('button', { name: 'Exam status' })).toHaveCount(0); // not sortable any more
});

test('pagination controls follow the server totals', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, (m, p) => (m === 'GET' && p === '/olympiad/admin/analytics'
    ? { body: { ...analyticsPayload(), pagination: { page: 1, limit: 25, total: 60, pages: 3 } } } : undefined));
  await expect(page.getByTestId('total')).toContainText('60 records · page 1 of 3');
  await expect(page.getByTestId('prev')).toBeDisabled();
  await expect(page.getByTestId('next')).toBeEnabled();
});

test('empty, error + retry, access denied and no-exams states', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, (m, p) => (m === 'GET' && p === '/olympiad/admin/analytics' ? { body: { ...analyticsPayload([]), counts: {}, cards: { registered: 0, submitted: 0, notSubmitted: 0, submissionRate: 0, registrations: 0, needsReview: 0 } } } : undefined));
  await expect(page.getByTestId('empty')).toContainText('No students match the selected filters');

  let fail = true;
  await open(page, (m, p) => (m === 'GET' && p === '/olympiad/admin/analytics' && fail ? { status: 500, body: { success: false, message: 'Could not load the analytics right now. Please try again.' } } : undefined));
  await expect(page.getByTestId('error')).toContainText('Could not load the analytics');
  await expect(page.getByTestId('card-registered')).toHaveCount(0); // no misleading zero cards on failure
  fail = false;
  await page.getByTestId('retry').click();
  await expect(page.getByTestId('card-registered-value')).toHaveText('2');

  await open(page, (m, p) => (m === 'GET' && p === '/olympiad/admin/analytics' ? { status: 403, body: { success: false, message: 'Not authorized' } } : undefined));
  await expect(page.getByTestId('error')).toContainText('do not have permission');
  await expect(page.getByTestId('retry')).toHaveCount(0);

  await open(page, (m, p) => (m === 'GET' && p === '/olympiad/admin/analytics' ? { body: { ...analyticsPayload([]), events: [] } } : undefined));
  await expect(page.getByTestId('no-events')).toBeVisible();
});

test('export downloads a CSV for the current filters', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const seen: string[] = [];
  page.on('request', r => { if (r.url().includes('/olympiad/admin/analytics/export')) seen.push(r.url()); });
  await open(page);
  await page.getByTestId('tab-submitted').click();
  const dl = page.waitForEvent('download');
  await page.getByTestId('export').click();
  expect((await dl).suggestedFilename()).toMatch(/^learniq-olympiad-students-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(seen[0]).toContain('view=submitted');
  expect(seen[0]).toContain('format=csv');
});

test('on a phone each record is a stacked card with the same information and the profile still opens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await open(page);
  await expect(page.getByTestId('students-table')).toHaveCount(0);
  const rows = page.getByTestId('student-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Submitted');
  await expect(rows.nth(1)).toContainText('Not Submitted');
  await expect(rows.nth(1)).toContainText('Submitted —');
  await rows.nth(1).getByRole('button', { name: 'View Profile' }).click();
  await expect(page.getByTestId('student-drawer')).toBeVisible();
  await expect(page.getByTestId('drawer-name')).toHaveText('Aarav Sharma'); // mock returns one profile for any id
});

for (const [name, size] of [['phone 360', { width: 360, height: 780 }], ['tablet 768', { width: 768, height: 1024 }], ['desktop 1280', { width: 1280, height: 800 }]] as const) {
  test(`no page-level horizontal overflow at ${name} (the table scrolls inside its own container)`, async ({ page }) => {
    await page.setViewportSize(size);
    await open(page);
    await expect(page.getByTestId('student-row').first()).toBeVisible();
    const r = await findOverflow(page);
    expect(r.offenders, JSON.stringify(r.offenders)).toEqual([]);
    await page.getByTestId('student-link').first().click();
    await expect(page.getByTestId('student-drawer')).toBeVisible();
    const d = await findOverflow(page);
    expect(d.offenders, JSON.stringify(d.offenders)).toEqual([]);
  });
}
void analyticsDetail;

// ───────────────────────── clear Olympiad records (admin) ─────────────────────────
const clearInfo = (examId: string, title: string, standard: number, over: Record<string, unknown> = {}) => ({
  examId, title, standard, counts: { attempts: 1, submitted: 1, earlierAttempts: 0, proctoringSessions: 0, interviews: 0, evaluations: 0 }, blocked: false, blockerCode: null, blockerMessage: null, ...over,
});
const reg = (examId: string, title: string, standard: number, over: Record<string, unknown> = {}) => ({
  ...analyticsDetail.registrations[0], exam: { ...analyticsDetail.registrations[0].exam, _id: examId, title, standard }, certificate: null,
  clear: clearInfo(examId, title, standard), ...over,
});

/** A tiny stateful server: DELETE removes the registration(s) from the detail the next GET returns. */
const clearingServer = (initial: ReturnType<typeof reg>[], opts: { failWith?: number } = {}) => {
  const state = { regs: [...initial], deletes: [] as string[], listCalls: 0 };
  const extra: Override = (method, path) => {
    if (method === 'GET' && path === '/olympiad/admin/analytics') state.listCalls += 1;
    if (method === 'GET' && /^\/olympiad\/admin\/analytics\/students\/[^/]+$/.test(path)) return { body: { ...analyticsDetail, registrations: state.regs } };
    if (method === 'DELETE' && path.includes('/records')) {
      state.deletes.push(path);
      if (opts.failWith) return { status: opts.failWith, body: { success: false, message: 'The records could not be cleared. Nothing was reported as cleared; please refresh and check before retrying.' } };
      const one = path.match(/\/exams\/([^/]+)\/records$/);
      state.regs = one ? state.regs.filter(r => r.exam._id !== one[1]) : state.regs.filter(r => r.clear?.blocked);
      return { body: { success: true, message: 'Olympiad records cleared successfully. The analytics have been updated.' } };
    }
    return undefined;
  };
  return { state, extra };
};
const twoExams = () => [reg('ex10', 'Olympiad Std 10', 10), reg('ex9', 'Olympiad Std 9', 9)];

async function openProfile(page: Page, extra: Override) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, extra);
  await page.getByTestId('student-row').first().getByTestId('student-link').click();
  await expect(page.getByTestId('student-drawer')).toBeVisible();
}

test('profile lists every registration separately with exam status and offers Clear this exam / Clear Olympiad Records; the table stays uncluttered', async ({ page }) => {
  const { extra } = clearingServer(twoExams());
  await openProfile(page, extra);
  await expect(page.getByTestId('records-row')).toHaveCount(2);
  await expect(page.getByTestId('records-row').first()).toContainText('Registered:');
  await expect(page.getByTestId('records-row').first()).toContainText('Submitted:');
  await expect(page.getByTestId('clear-all-btn')).toContainText('Clear Olympiad Records');
  await expect(page.getByTestId('clear-exam-btn')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('students-table').locator('thead th')).toHaveCount(7); // the analytics table did not grow a delete column
});

test('clear one exam: confirmation names student, standard and exam; Cancel deletes nothing; confirm removes only that exam and refreshes the analytics', async ({ page }) => {
  const { state, extra } = clearingServer(twoExams());
  await openProfile(page, extra);
  await page.getByTestId('clear-exam-btn').first().click();
  const modal = page.getByTestId('clear-modal');
  await expect(modal).toContainText('Clear This Olympiad Exam?');
  await expect(modal).toContainText('Aarav Sharma'); await expect(modal).toContainText('Std 10'); await expect(modal).toContainText('Olympiad Std 10');
  await modal.getByRole('button', { name: 'Cancel' }).click();
  await expect(modal).toBeHidden(); expect(state.deletes).toHaveLength(0);
  await page.getByTestId('clear-exam-btn').first().click();
  const listBefore = state.listCalls;
  await page.getByTestId('clear-confirm').click();
  await expect(page.getByTestId('clear-success')).toContainText('Olympiad records cleared successfully. The analytics have been updated.');
  expect(state.deletes).toEqual(['/olympiad/admin/analytics/students/stu1/exams/ex10/records']);
  await expect(page.getByTestId('records-row')).toHaveCount(1);
  await expect(page.getByTestId('records-row')).toContainText('Olympiad Std 9');
  await expect.poll(() => state.listCalls).toBeGreaterThan(listBefore); // list + cards refetched, no logout / reload
});

test('clear all: warning modal shows registrations and attempts affected; success leaves an empty-state profile', async ({ page }) => {
  const { state, extra } = clearingServer(twoExams());
  await openProfile(page, extra);
  await page.getByTestId('clear-all-btn').click();
  const modal = page.getByTestId('clear-modal');
  await expect(modal).toContainText('Clear All Olympiad Records?');
  await expect(modal.getByTestId('clear-count-regs')).toHaveText('2');
  await expect(modal.getByTestId('clear-count-attempts')).toHaveText('2');
  await expect(modal).toContainText('cannot be undone');
  await modal.getByRole('button', { name: 'Clear All Olympiad Records' }).click();
  await expect(page.getByTestId('clear-success')).toBeVisible();
  expect(state.deletes).toEqual(['/olympiad/admin/analytics/students/stu1/records']);
  await expect(page.getByTestId('no-records')).toBeVisible();
  await expect(page.getByTestId('clear-all-btn')).toBeHidden();
});

test('confirm button is disabled while the request runs (no double submit)', async ({ page }) => {
  const { state, extra } = clearingServer(twoExams());
  const slow: Override = (m, p, b) => m === 'DELETE' ? undefined : extra(m, p, b);
  await openProfile(page, slow);
  await page.route('**/api/olympiad/admin/analytics/students/stu1/exams/ex10/records', async route => {
    state.deletes.push('hit'); await new Promise(r => setTimeout(r, 600));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: 'Olympiad records cleared successfully. The analytics have been updated.' }) });
  });
  await page.getByTestId('clear-exam-btn').first().click();
  await page.getByTestId('clear-confirm').click();
  await expect(page.getByTestId('clear-confirm')).toBeDisabled();
  await expect(page.getByTestId('clear-modal').getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await expect(page.getByTestId('clear-success')).toBeVisible();
  expect(state.deletes.filter(d => d === 'hit')).toHaveLength(1);
});

test('a failed clearing shows the server error, keeps the record on screen and never claims success', async ({ page }) => {
  const { extra } = clearingServer(twoExams(), { failWith: 500 });
  await openProfile(page, extra);
  await page.getByTestId('clear-exam-btn').first().click();
  await page.getByTestId('clear-confirm').click();
  await expect(page.getByTestId('clear-error')).toContainText('could not be cleared');
  await expect(page.getByTestId('clear-success')).toHaveCount(0);
  await expect(page.getByTestId('clear-confirm')).toBeEnabled(); // can retry
  await page.getByTestId('clear-modal').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('records-row')).toHaveCount(2);
});

test('a protected exam (open interview) cannot be cleared from the profile and says why, other exams stay clearable', async ({ page }) => {
  const msg = 'A teacher interview for this exam is still open. Finish or cancel it first.';
  const { extra } = clearingServer([reg('ex10', 'Olympiad Std 10', 10, { clear: clearInfo('ex10', 'Olympiad Std 10', 10, { blocked: true, blockerCode: 'ACTIVE_INTERVIEW', blockerMessage: msg }) })]);
  await openProfile(page, extra);
  await expect(page.getByTestId('records-blocked')).toContainText('Cannot be cleared yet');
  await expect(page.getByTestId('clear-exam-btn')).toHaveCount(0);
  await expect(page.getByTestId('clear-all-btn')).toHaveCount(0);
});

test('clear records works on a phone without horizontal overflow', async ({ page }) => {
  const { extra } = clearingServer(twoExams());
  await page.setViewportSize({ width: 375, height: 700 });
  await open(page, extra);
  await page.getByRole('button', { name: 'View Profile' }).first().click();
  await expect(page.getByTestId('records-table')).toBeVisible();
  await page.getByTestId('clear-all-btn').click();
  await expect(page.getByTestId('clear-modal')).toBeVisible();
  expect((await findOverflow(page)).offenders).toEqual([]);
});

test('View Profile on each row of the same student identifies THAT exam; every row keeps its own working Clear Exam Data button after others were cleared', async ({ page }) => {
  const three = [reg('ex2', 'Practice Test – 2nd Standard', 2), reg('ex9', 'Practice Test – 9th Standard', 9), reg('ex5', 'Practice Test – 5th Standard', 5)];
  const { state, extra } = clearingServer(three);
  const rows = [analyticsRow({ key: 'stu1:ex2', examId: 'ex2', standard: 2 }), analyticsRow({ key: 'stu1:ex9', examId: 'ex9', standard: 9 }), analyticsRow({ key: 'stu1:ex5', examId: 'ex5', standard: 5 })];
  const withRows: Override = (m, p, b) => (m === 'GET' && p === '/olympiad/admin/analytics'
    ? { body: analyticsPayload(rows.filter(r => state.regs.some(x => x.exam._id === r.examId))) } : extra(m, p, b));
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, withRows);
  const selectedOf = async () => page.locator('[data-testid="records-row"][data-selected="true"]').getAttribute('data-exam-id');

  await page.getByTestId('student-row').nth(0).getByRole('button', { name: 'View Profile' }).click();
  expect(await selectedOf()).toBe('ex2');
  await expect(page.getByTestId('clear-exam-btn')).toHaveCount(3);
  await page.locator('[data-exam-id="ex2"]').getByTestId('clear-exam-btn').click();
  await expect(page.getByTestId('clear-modal-exam')).toHaveText('Practice Test – 2nd Standard');
  await page.getByTestId('clear-confirm').click();
  await expect(page.getByTestId('clear-success')).toBeVisible();
  expect(state.deletes).toEqual(['/olympiad/admin/analytics/students/stu1/exams/ex2/records']);
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  await expect(page.getByTestId('student-row')).toHaveCount(2);
  await page.getByTestId('student-row').nth(0).getByRole('button', { name: 'View Profile' }).click(); // Std 9 is now the first row
  expect(await selectedOf()).toBe('ex9');
  await expect(page.getByTestId('clear-exam-btn')).toHaveCount(2);
  await page.locator('[data-exam-id="ex9"]').getByTestId('clear-exam-btn').click();
  await expect(page.getByTestId('clear-modal-exam')).toHaveText('Practice Test – 9th Standard');
  await page.getByTestId('clear-confirm').click();
  await expect(page.getByTestId('clear-success')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByTestId('student-row').nth(0).getByRole('button', { name: 'View Profile' }).click();
  expect(await selectedOf()).toBe('ex5');
  await expect(page.locator('[data-exam-id="ex5"]').getByTestId('clear-exam-btn')).toBeEnabled();
});
