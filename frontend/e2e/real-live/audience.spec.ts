import { test, expect, type Page, type Browser } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { findOverflow } from '../layout';

/**
 * "Who can join this meeting?" in REAL Chromium against the REAL server (in-memory database): the teacher builds an audience in the
 * settings dialog (desktop and phone), it is saved and restored, and students / teachers are admitted or refused by the SERVER.
 */
type Person = { id: string; name: string; token: string };
type Fixture = { base: string; teacher: Person; students: Person[]; std10: Person; std8: Person; guest: Person };
let server: ChildProcess; let fx: Fixture;

test.beforeAll(async () => {
  const cwd = path.resolve(process.cwd(), '..', 'backend');
  server = spawn('node', ['src/tests/helpers/liveE2eServer.js', '5056', '12000', '3000'], { cwd, stdio: ['ignore', 'pipe', 'inherit'] });
  fx = await new Promise<Fixture>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('live e2e server did not start')), 25000);
    server.stdout!.on('data', (d: Buffer) => { const line = d.toString().split('\n').find((l) => l.startsWith('READY ')); if (line) { clearTimeout(t); resolve(JSON.parse(line.slice(6))); } });
    server.on('exit', () => reject(new Error('live e2e server exited')));
  });
});
test.afterAll(() => { server?.kill(); });

const api = async (method: string, url: string, token: string | null, body?: unknown) => {
  const res = await fetch(`${fx.base}/api${url}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => ({})) as any };
};
const errors: string[] = [];
const open = async (browser: Browser, token: string, url: string, viewport = { width: 1280, height: 800 }): Promise<Page> => {
  const ctx = await browser.newContext({ viewport, permissions: ['camera', 'microphone'], hasTouch: viewport.width < 800, isMobile: viewport.width < 600 });
  await ctx.addInitScript((t) => localStorage.setItem('learniq_token', t), token);
  const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message)); await page.goto(url);
  return page;
};
test.afterEach(() => { expect(errors, 'no page errors').toEqual([]); errors.length = 0; });

for (const vp of [{ width: 1280, height: 800, label: 'desktop' }, { width: 390, height: 844, label: 'phone' }]) {
  test(`teacher builds a multi-standard + selected-teacher audience, it is saved, restored, and enforced @${vp.label}`, async ({ browser }) => {
    const page = await open(browser, fx.teacher.token, '/teacher/live', vp);
    await page.getByRole('button', { name: /Create Session/ }).first().click();
    await page.getByPlaceholder('e.g., Trigonometry Masterclass').fill(`Audience class ${vp.label}`);
    const aud = page.getByTestId('audience-selector');
    await expect(aud).toBeVisible();
    // the old standalone Standard dropdown is gone; Subject takes its row and nothing overflows
    await expect(page.getByLabel('Standard', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Standard 10', { exact: true })).toHaveCount(0);
    const subj = (await page.locator('select').filter({ hasText: 'Mathematics' }).first().boundingBox())!; expect(subj.x + subj.width).toBeLessThanOrEqual(vp.width + 1);
    await expect(aud.getByText('Who can join this meeting?')).toBeVisible();
    await expect(page.getByTestId('audience-summary')).toContainText('All students — all standards');
    await expect(page.getByTestId('audience-summary')).toContainText('Teachers: No teachers');

    // multiple standards: the list comes from the server, Select all / Clear selection, empty selection is refused
    await aud.getByText('Multiple selected standards').click();
    await expect(page.getByTestId('standards-picker')).toBeVisible();
    await expect(page.getByTestId('standards-picker').getByLabel('Others')).toBeVisible();
    await page.getByRole('button', { name: 'Clear selection' }).click();
    await expect(page.getByTestId('audience-error')).toContainText('at least one standard');
    const create = page.getByLabel('Create live session').getByRole('button', { name: 'Create Session' });
    await expect(create).toBeDisabled();
    for (const n of [8, 9, 10]) await page.getByTestId('standards-picker').getByLabel(`Standard ${n}`, { exact: true }).check();
    await expect(page.getByTestId('audience-summary')).toContainText('Students: Standards 8, 9 and 10');
    await expect(page.getByTestId('standards-selected')).toContainText('Standard 8, Standard 9, Standard 10');
    await expect(create).toBeEnabled();

    // students AND teachers: separate controls, teacher search, selected shown as a removable chip
    await aud.getByText('Students and teachers', { exact: true }).click();
    await expect(page.getByTestId('both-students')).toBeVisible();
    await page.getByTestId('both-students').locator('select').selectOption('standards');
    for (const n of [8, 9, 10]) await page.getByTestId('both-students').getByLabel(`Standard ${n}`, { exact: true }).check();
    await page.getByTestId('both-teachers').locator('select').selectOption('selected');
    await expect(create).toBeDisabled();
    await expect(page.getByTestId('audience-error')).toContainText('at least one teacher');
    await page.getByLabel('Search teachers').fill('Priya');
    await page.getByRole('checkbox', { name: /Priya Guest Teacher/ }).check();
    await expect(page.getByTestId('teacher-count')).toHaveText('1 teacher selected');
    await expect(page.getByTestId('audience-summary')).toContainText('Teachers: 1 selected teacher');
    await expect(page.getByRole('button', { name: 'Remove Priya Guest Teacher' })).toBeVisible();
    expect((await findOverflow(page)).offenders).toEqual([]);

    await create.click();
    const card = page.locator('.card-soft', { hasText: `Audience class ${vp.label}` });
    await expect(card.getByTestId('audience-label')).toContainText('Standards 8, 9 and 10 + 1 selected teacher');

    // saved in the database: a fresh page load shows the same, and the settings dialog restores the selection
    await page.reload();
    const card2 = page.locator('.card-soft', { hasText: `Audience class ${vp.label}` });
    await expect(card2.getByTestId('audience-label')).toContainText('Standards 8, 9 and 10 + 1 selected teacher');
    await card2.getByTestId('edit-meeting-settings').click();
    await expect(page.getByTestId('audience-summary')).toContainText('Students: Standards 8, 9 and 10');
    await expect(page.getByTestId('audience-summary')).toContainText('Teachers: 1 selected teacher');
    await expect(page.getByRole('button', { name: 'Remove Priya Guest Teacher' })).toBeVisible();
    expect((await findOverflow(page)).offenders).toEqual([]);
    await page.getByRole('button', { name: 'Cancel' }).click();

    // the SERVER decides who gets in: wrong standard refused, right standard waits for the host, selected teacher is let in as an attendee
    const list = await api('GET', '/teacher/live-sessions', fx.teacher.token);
    const sess = list.json.sessions.find((s: any) => s.title === `Audience class ${vp.label}`);
    await api('POST', `/teacher/live-sessions/${sess._id}/start`, fx.teacher.token);
    const wrong = await open(browser, fx.students[0].token, `/live/${sess.sessionCode}`, vp);
    await expect(wrong.getByTestId('screen-denied')).toContainText("You can't join this class");
    await expect(wrong.getByTestId('screen-denied')).toContainText('not open to your account');
    expect((await findOverflow(wrong)).offenders).toEqual([]);
    const right = await open(browser, fx.std10.token, `/live/${sess.sessionCode}`, vp);
    await expect(right.getByTestId('screen-waiting')).toBeVisible();
    const guest = await open(browser, fx.guest.token, `/live/${sess.sessionCode}`, vp);
    await expect(guest.getByTestId('screen-waiting')).toBeVisible();
    // direct API calls cannot bypass it either
    expect((await api('POST', `/live-sessions/${sess.sessionCode}/join`, fx.students[0].token)).status).toBe(403);
    expect((await api('POST', `/live-sessions/${sess.sessionCode}/join`, fx.std8.token)).status).toBe(200);
    // dashboards: the invited teacher sees it; the std-7 student does not
    const inv = await api('GET', '/teacher/live-sessions', fx.guest.token);
    expect(inv.json.invitedSessions.map((s: any) => s.title)).toContain(`Audience class ${vp.label}`);
    const seen7 = await api('GET', '/live-sessions', fx.students[0].token);
    expect(seen7.json.sessions.map((s: any) => s.title)).not.toContain(`Audience class ${vp.label}`);
    const seen10 = await api('GET', '/live-sessions', fx.std10.token);
    expect(seen10.json.sessions.map((s: any) => s.title)).toContain(`Audience class ${vp.label}`);
  });
}

test('selected individual students: server-side search shows name and standard only, large lists are not loaded into the page', async ({ browser }) => {
  const page = await open(browser, fx.teacher.token, '/teacher/live');
  await page.getByRole('button', { name: /Create Session/ }).first().click();
  await page.getByTestId('audience-selector').getByText('Selected individual students').click();
  await expect(page.getByTestId('audience-error')).toContainText('at least one student');
  await page.getByLabel('Search students').fill('T');
  await expect(page.getByText('Type at least 2 letters')).toBeVisible();
  await page.getByLabel('Search students').fill('Tara');
  const row = page.getByRole('checkbox', { name: /Tara Tenth/ });
  await expect(row).toBeVisible();
  await expect(page.getByTestId('picker-student')).toContainText('Standard 10');
  await expect(page.getByTestId('picker-student')).not.toContainText('@');
  await row.check();
  await expect(page.getByTestId('student-count')).toHaveText('1 student selected');
  await page.getByLabel('Search students').fill('Eshan');
  await page.getByRole('checkbox', { name: /Eshan Eighth/ }).check();
  await expect(page.getByTestId('student-count')).toHaveText('2 students selected');
  await expect(page.getByTestId('audience-summary')).toContainText('Students: 2 selected students');
  await page.getByRole('button', { name: 'Remove Tara Tenth' }).click();
  await expect(page.getByTestId('student-count')).toHaveText('1 student selected');
  await page.getByLabel('Search students').fill('zzzz-nobody');
  await expect(page.getByText(/No students match/)).toBeVisible();
});
