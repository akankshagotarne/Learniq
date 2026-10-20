import { test, expect, type Page, type Browser, type BrowserContext } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { findOverflow } from '../layout';

/**
 * LearnIQ live classes in REAL Chromium against the REAL signalling server (in-memory database, fake capture devices).
 * Group C (main stage + mobile UX), the browser half of Group A (MCQ popup / rank card), Group B (visibility modes) and Group E (admin console).
 * The MCQ window is 12 s and the ranking card 3 s here (the backend suite covers the production 15 s / 5 s values with the same engine).
 */
type Person = { id: string; name: string; token: string };
type Fixture = { base: string; code: string; staleCode: string; teacher: Person; admin: Person; students: Person[] };
let server: ChildProcess; let fx: Fixture;
const WINDOW_MS = 12000; const RANK_MS = 3000;

test.beforeAll(async () => {
  const cwd = path.resolve(process.cwd(), '..', 'backend');
  server = spawn('node', ['src/tests/helpers/liveE2eServer.js', '5056', String(WINDOW_MS), String(RANK_MS)], { cwd, stdio: ['ignore', 'pipe', 'inherit'] });
  fx = await new Promise<Fixture>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('live e2e server did not start')), 25000);
    server.stdout!.on('data', (d: Buffer) => { const line = d.toString().split('\n').find((l) => l.startsWith('READY ')); if (line) { clearTimeout(t); resolve(JSON.parse(line.slice(6))); } });
    server.on('exit', () => reject(new Error('live e2e server exited')));
  });
});
test.afterAll(() => { server?.kill(); });

const api = async (method: string, url: string, token: string, body?: unknown) => {
  const res = await fetch(`${fx.base}/api${url}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => ({})) as any };
};
/** a fresh, started class owned by the teacher */
const newClass = async (meetingConfig?: Record<string, unknown>) => {
  const c = await api('POST', '/live-sessions', fx.teacher.token, { title: 'Algebra revision', subject: 'Mathematics', standard: 7, scheduledAt: new Date().toISOString(), ...(meetingConfig ? { meetingConfig } : {}) });
  expect(c.status).toBeLessThan(300);
  const s = await api('POST', `/teacher/live-sessions/${c.json.session._id}/start`, fx.teacher.token);
  expect(s.status).toBeLessThan(300);
  return c.json.session.sessionCode as string;
};

/** the element (after its entrance animation) lies completely inside the viewport */
const expectInside = async (el: import('@playwright/test').Locator, vp: { width: number; height: number }) => {
  await expect.poll(async () => { const b = await el.boundingBox(); return !!b && b.x >= -1 && b.y >= -1 && b.x + b.width <= vp.width + 1 && b.y + b.height <= vp.height + 1; }, { message: 'fits inside the viewport', timeout: 4000 }).toBe(true);
};
const errors: string[] = [];
const watch = (page: Page) => { page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`)); page.on('crash', () => errors.push('renderer crash')); };
const open = async (browser: Browser, token: string, url: string, viewport = { width: 1280, height: 800 }): Promise<{ ctx: BrowserContext; page: Page }> => {
  const ctx = await browser.newContext({ viewport, permissions: ['camera', 'microphone'], hasTouch: viewport.width < 800, isMobile: viewport.width < 600 });
  await ctx.addInitScript((t) => localStorage.setItem('learniq_token', t), token);
  const page = await ctx.newPage(); watch(page); await page.goto(url);
  return { ctx, page };
};
const admit = async (host: Page, name: string) => {
  await host.getByTestId('btn-people').click();
  await host.getByRole('button', { name: `Admit ${name}` }).click();
  await host.getByRole('button', { name: 'Close' }).first().click({ trial: false }).catch(() => {});
};
const peopleClose = async (page: Page) => { if (await page.getByTestId('participants-panel').isVisible().catch(() => false)) await page.keyboard.press('Escape'); };
const startCamera = async (page: Page) => { await page.getByTestId('btn-cam').click(); await expect(page.getByTestId('btn-cam')).toHaveAttribute('aria-pressed', 'true'); };

test.afterEach(() => { expect(errors, 'no page errors or renderer crashes').toEqual([]); errors.length = 0; });

const VIEWPORTS = [
  { name: '320', width: 320, height: 640 }, { name: '360', width: 360, height: 740 }, { name: '375', width: 375, height: 667 }, { name: '390', width: 390, height: 844 },
  { name: '430', width: 430, height: 932 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'desktop', width: 1280, height: 800 },
];

for (const vp of VIEWPORTS) {
  test(`C/A ${vp.name}: student sees the teacher on the main stage, chat is secondary, question + rank card fit`, async ({ browser }) => {
    const code = await newClass();
    const t = await open(browser, fx.teacher.token, `/live/${code}`);
    await expect(t.page.getByTestId('main-stage')).toBeVisible();
    await startCamera(t.page);

    const s = await open(browser, fx.students[0].token, `/live/${code}`, { width: vp.width, height: vp.height });
    await expect(s.page.getByTestId('screen-waiting')).toBeVisible();
    expect((await findOverflow(s.page)).offenders, 'waiting screen has no horizontal overflow').toEqual([]);
    await admit(t.page, fx.students[0].name);

    // C: the MAIN stage is the teacher's camera - not the chat, not an arbitrary tile
    const stage = s.page.getByTestId('main-stage');
    await expect(stage).toBeVisible();
    await expect(stage).toHaveAttribute('data-stage-kind', 'host');
    await expect(stage).toHaveAttribute('data-stage-state', 'camera', { timeout: 20000 });
    await expect(s.page.getByTestId('chat-panel')).toHaveCount(0);
    const box = (await stage.boundingBox())!;
    expect(box.width, 'stage uses the screen width').toBeGreaterThan(vp.width * 0.8);
    expect(box.height, 'stage uses a large part of the screen height').toBeGreaterThan(vp.height * 0.25);
    await expect.poll(() => stage.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth > 0 && !v.paused), { message: 'teacher video is really playing', timeout: 15000 }).toBe(true);
    const report = await findOverflow(s.page);
    expect(report.offenders, JSON.stringify(report.offenders)).toEqual([]);
    expect(report.scrollWidth).toBeLessThanOrEqual(report.viewport);
    // touch targets of the control bar
    for (const b of await s.page.getByTestId('control-bar').getByRole('button').all()) {
      const bb = await b.boundingBox(); if (bb) { expect(bb.width, 'control width').toBeGreaterThanOrEqual(44); expect(bb.height, 'control height').toBeGreaterThanOrEqual(44); }
    }

    // chat opens on demand as a sheet / slide-over / docked column, and never overflows
    await s.page.getByTestId('btn-chat').click();
    const chat = s.page.getByTestId('chat-panel'); await expect(chat).toBeVisible();
    const cb = (await chat.boundingBox())!; expect(cb.x + cb.width).toBeLessThanOrEqual(vp.width + 1); expect(cb.x).toBeGreaterThanOrEqual(-1);
    expect((await findOverflow(s.page)).offenders).toEqual([]);
    await chat.getByRole('button', { name: 'Close chat' }).click();
    await expect(chat).toHaveCount(0);

    // A: launch a question from the teacher UI
    await t.page.getByTestId('btn-more').click(); await t.page.getByTestId('open-mcq').click();
    await t.page.getByPlaceholder('Type your question').fill('What is the value of sin 90 degrees?');
    await t.page.getByLabel('Option A', { exact: true }).fill('0'); await t.page.getByLabel('Option B', { exact: true }).fill('1');
    await t.page.getByLabel('Option C', { exact: true }).fill('0.5'); await t.page.getByLabel('Option D', { exact: true }).fill('Undefined');
    await t.page.getByLabel('Option B is correct').check();
    await t.page.getByTestId('host-mcq-launch').click();

    const popup = s.page.getByTestId('mcq-popup'); await expect(popup).toBeVisible();
    await expectInside(popup.locator('[role=dialog]'), vp);
    expect((await findOverflow(s.page)).offenders).toEqual([]);
    for (const sel of ['mcq-option-0', 'mcq-option-3', 'mcq-submit']) { const bb = (await s.page.getByTestId(sel).boundingBox())!; expect(bb.height, sel).toBeGreaterThanOrEqual(44); }
    await expect(s.page.getByTestId('mcq-submit')).toBeDisabled();       // nothing selected yet
    await s.page.getByTestId('mcq-option-1').click();
    await s.page.getByTestId('mcq-submit').click();
    await expect(popup).toHaveCount(0, { timeout: 3000 });                // gone as soon as the server acknowledged the answer

    // ranking card after the common deadline: top list, fits, then auto-dismisses
    const card = s.page.getByTestId('rank-card'); await expect(card).toBeVisible({ timeout: WINDOW_MS + 4000 });
    await expect(card).toContainText('LearnIQ');
    await expect(card).toContainText('MCQ Champions');
    await expect(s.page.getByTestId('rank-row-1')).toContainText(fx.students[0].name.split(' ')[0]);
    await expect(s.page.getByTestId('rank-row-1')).toContainText(/\d\.\d sec/);
    await expectInside(card.locator('> div'), vp);
    expect((await findOverflow(s.page)).offenders).toEqual([]);
    await expect(card).toHaveCount(0, { timeout: RANK_MS + 3000 });

    await t.ctx.close(); await s.ctx.close();
  });
}

test('A: a student who has not answered keeps the popup until the deadline; an answered student does not see it again after refresh; the popup ends with the deadline', async ({ browser }) => {
  const code = await newClass({ requireApproval: false });
  const t = await open(browser, fx.teacher.token, `/live/${code}`);
  const a = await open(browser, fx.students[1].token, `/live/${code}`, { width: 390, height: 844 });
  const b = await open(browser, fx.students[2].token, `/live/${code}`, { width: 390, height: 844 });
  await expect(a.page.getByTestId('main-stage')).toBeVisible(); await expect(b.page.getByTestId('main-stage')).toBeVisible();
  await t.page.getByTestId('btn-more').click(); await t.page.getByTestId('open-mcq').click();
  await t.page.getByPlaceholder('Type your question').fill('Which planet is known as the red planet?');
  await t.page.getByLabel('Option A', { exact: true }).fill('Venus'); await t.page.getByLabel('Option B', { exact: true }).fill('Mars');
  await t.page.getByRole('button', { name: 'Remove option D' }).click(); await t.page.getByRole('button', { name: 'Remove option C' }).click();   // a two-option question
  await t.page.getByLabel('Option B is correct').check();
  await t.page.getByTestId('host-mcq-launch').click();
  await expect(a.page.getByTestId('mcq-popup')).toBeVisible(); await expect(b.page.getByTestId('mcq-popup')).toBeVisible();
  await a.page.getByTestId('mcq-option-1').click(); await a.page.getByTestId('mcq-submit').click();
  await expect(a.page.getByTestId('mcq-popup')).toHaveCount(0, { timeout: 3000 });
  await expect(b.page.getByTestId('mcq-popup')).toBeVisible();          // B has not answered: still open
  await a.page.reload();                                                   // refresh: the server remembers that A answered
  await expect(a.page.getByTestId('main-stage')).toBeVisible();
  await expect(a.page.getByTestId('mcq-popup')).toHaveCount(0);
  await expect(b.page.getByTestId('mcq-popup')).toBeVisible();
  await expect(b.page.getByTestId('rank-card')).toBeVisible({ timeout: WINDOW_MS + 4000 });  // B never answered: popup ended with the deadline, then the card
  await expect(b.page.getByTestId('mcq-popup')).toHaveCount(0);
  await expect(b.page.getByTestId('rank-row-1')).toContainText(fx.students[1].name.split(' ')[0]);
  await t.ctx.close(); await a.ctx.close(); await b.ctx.close();
});

test('B: host-only mode - students see the teacher but not each other; switching mode in the meeting updates a student live', async ({ browser }) => {
  const code = await newClass({ requireApproval: false, mode: 'host_only' });
  const t = await open(browser, fx.teacher.token, `/live/${code}`);
  await startCamera(t.page);
  const a = await open(browser, fx.students[0].token, `/live/${code}`, { width: 390, height: 844 });
  const b = await open(browser, fx.students[1].token, `/live/${code}`, { width: 390, height: 844 });
  await expect(a.page.getByTestId('main-stage')).toHaveAttribute('data-stage-state', 'camera', { timeout: 20000 });
  await startCamera(b.page);
  // student A must not be offered student B (not in the roster list, no tile)
  await a.page.getByRole('button', { name: 'Participants' }).click();
  await expect(a.page.getByTestId('participants-panel')).not.toContainText(fx.students[1].name);
  await a.page.keyboard.press('Escape');
  // the teacher sees both students
  await t.page.getByTestId('btn-people').click();
  await expect(t.page.getByTestId('participants-panel')).toContainText(fx.students[0].name);
  await expect(t.page.getByTestId('participants-panel')).toContainText(fx.students[1].name);
  await t.page.keyboard.press('Escape');
  // the teacher switches to "everyone sees everyone" in the meeting: the change reaches student A at once
  await t.page.getByTestId('btn-more').click(); await t.page.getByTestId('open-settings').click();
  await t.page.getByText('Everyone can see everyone').click();
  await t.page.getByTestId('settings-apply').click();
  await expect(t.page.getByText('Settings applied for everyone in the class.')).toBeVisible();
  await a.page.getByRole('button', { name: 'Participants' }).click();
  await expect(a.page.getByTestId('participants-panel')).toContainText(fx.students[1].name, { timeout: 10000 });
  await t.ctx.close(); await a.ctx.close(); await b.ctx.close();
});

test('C: a shared screen takes the main stage on a phone, and the teacher camera returns when sharing stops', async ({ browser }) => {
  const code = await newClass({ requireApproval: false });
  const t = await open(browser, fx.teacher.token, `/live/${code}`);
  await startCamera(t.page);
  const s = await open(browser, fx.students[0].token, `/live/${code}`, { width: 375, height: 667 });
  await expect(s.page.getByTestId('main-stage')).toHaveAttribute('data-stage-state', 'camera', { timeout: 20000 });
  await t.page.getByTestId('btn-screen').click();
  await expect(s.page.getByTestId('main-stage')).toHaveAttribute('data-stage-kind', 'screen', { timeout: 20000 });
  await expect(s.page.getByTestId('main-stage')).toHaveAttribute('data-stage-state', 'screen', { timeout: 20000 });
  expect((await findOverflow(s.page)).offenders).toEqual([]);
  await t.page.getByTestId('btn-screen').click();
  await expect(s.page.getByTestId('main-stage')).toHaveAttribute('data-stage-kind', 'host', { timeout: 15000 });
  await t.ctx.close(); await s.ctx.close();
});

test('E: admin dashboard lists classes, stale class is flagged, console opens without a participant tile, and admin actions work and are audited', async ({ browser }) => {
  const code = await newClass({ requireApproval: false });
  const t = await open(browser, fx.teacher.token, `/live/${code}`);
  const s = await open(browser, fx.students[0].token, `/live/${code}`, { width: 390, height: 844 });
  await expect(s.page.getByTestId('main-stage')).toBeVisible();
  const ad = await open(browser, fx.admin.token, '/admin/live', { width: 1280, height: 800 });
  await expect(ad.page.getByTestId('admin-live-dashboard')).toBeVisible();
  await expect(ad.page.getByTestId(`live-row-${code}`)).toBeVisible();
  await expect(ad.page.getByTestId(`live-row-${code}`)).toContainText('1 connected');
  await ad.page.getByRole('button', { name: 'live', exact: true }).click();
  await ad.page.getByRole('button', { name: 'all', exact: true }).click();
  await expect(ad.page.getByTestId(`live-row-${fx.staleCode}`).getByTestId('stale-badge')).toBeVisible();
  expect((await findOverflow(ad.page)).offenders).toEqual([]);

  // an admin who opens the student link is sent to the console, never into the class
  const viaLink = await open(browser, fx.admin.token, `/live/${code}`);
  await expect(viaLink.page).toHaveURL(new RegExp(`/admin/live/${code}`), { timeout: 15000 });
  await viaLink.ctx.close();

  await ad.page.getByTestId(`open-console-${code}`).click().catch(async () => { await ad.page.goto(`/admin/live/${code}`); });
  await expect(ad.page.getByTestId('admin-console')).toBeVisible();
  await expect(ad.page.getByTestId('participants-panel')).toContainText(fx.students[0].name);
  // the admin is not a participant: the teacher's list has only the student
  await t.page.getByTestId('btn-people').click();
  await expect(t.page.getByTestId('participants-panel')).not.toContainText('Admin Learniq');
  await t.page.keyboard.press('Escape');

  // admin locks admission -> a new student is refused; the lock is visible to the teacher
  await ad.page.getByTestId('lock-toggle').first().click();
  await expect(ad.page.getByText('Unlock admission').first()).toBeVisible();
  const late = await open(browser, fx.students[3].token, `/live/${code}`, { width: 390, height: 844 });
  await expect(late.page.getByText(/locked|not accepting|closed/i).first()).toBeVisible({ timeout: 15000 });
  await late.ctx.close();

  // admin removes the student -> the student sees it
  await ad.page.getByRole('button', { name: `Actions for ${fx.students[0].name}` }).click();
  await ad.page.getByRole('button', { name: `Remove ${fx.students[0].name}` }).click();
  await ad.page.getByTestId('confirm-remove').click();
  await expect(s.page.getByText(/removed/i).first()).toBeVisible({ timeout: 10000 });

  // audit trail shows what happened
  await ad.page.getByRole('tab', { name: /Activity log/ }).click();
  await expect(ad.page.getByTestId('audit-trail')).toContainText('Locked admission');
  await expect(ad.page.getByTestId('audit-trail')).toContainText('Removed a participant');

  // admin ends the class -> the teacher is told
  await ad.page.getByTestId('console-end').click(); await ad.page.getByTestId('console-confirm-end').click();
  await expect(t.page.getByText(/ended/i).first()).toBeVisible({ timeout: 10000 });
  await t.ctx.close(); await s.ctx.close(); await ad.ctx.close();
});

test('E (responsive): the console and dashboard have no horizontal overflow on a phone', async ({ browser }) => {
  const code = await newClass({ requireApproval: false });
  const t = await open(browser, fx.teacher.token, `/live/${code}`);
  await expect(t.page.getByTestId('main-stage')).toBeVisible();
  const ad = await open(browser, fx.admin.token, `/admin/live/${code}`, { width: 360, height: 740 });
  await expect(ad.page.getByTestId('admin-console')).toBeVisible();
  const r = await findOverflow(ad.page); expect(r.offenders, JSON.stringify(r.offenders)).toEqual([]);
  await ad.page.goto('/admin/live'); await expect(ad.page.getByTestId('admin-live-dashboard')).toBeVisible();
  const r2 = await findOverflow(ad.page); expect(r2.offenders, JSON.stringify(r2.offenders)).toEqual([]);
  await t.ctx.close(); await ad.ctx.close();
});
