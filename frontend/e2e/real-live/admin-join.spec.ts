import { test, expect, chromium, type Page, type Browser, type BrowserContext } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { findOverflow } from '../layout';

/**
 * Admin "Join Live Meeting" in REAL Chromium against the REAL signalling server (in-memory database, Chromium's fake microphone / camera):
 * three separate browser sessions - a teacher, a student and an administrator - are in ONE room. The admin enters without the teacher's
 * approval, really HEARS the teacher and the student (the received audio is measured with a Web Audio analyser, not assumed from an icon),
 * sees the teacher's video, speaks to the class, moderates with host-level rights, runs a question, leaves without ending the class,
 * and ends it only through the separate confirmed control.
 */
type Person = { id: string; name: string; token: string };
type Fixture = { base: string; teacher: Person; admin: Person; students: Person[] };
let server: ChildProcess; let fx: Fixture;
const WINDOW_MS = 8000; const RANK_MS = 3000;

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
const newClass = async (meetingConfig?: Record<string, unknown>) => {
  const c = await api('POST', '/live-sessions', fx.teacher.token, { title: 'Algebra revision', subject: 'Mathematics', standard: 7, scheduledAt: new Date().toISOString(), ...(meetingConfig ? { meetingConfig } : {}) });
  expect(c.status).toBeLessThan(300);
  const s = await api('POST', `/teacher/live-sessions/${c.json.session._id}/start`, fx.teacher.token);
  expect(s.status).toBeLessThan(300);
  return c.json.session.sessionCode as string;
};
const errors: string[] = [];
const watch = (page: Page) => { page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`)); page.on('crash', () => errors.push('renderer crash')); };
const open = async (browser: Browser, token: string, url: string, viewport = { width: 1280, height: 800 }): Promise<{ ctx: BrowserContext; page: Page }> => {
  const ctx = await browser.newContext({ viewport, permissions: ['camera', 'microphone'], hasTouch: viewport.width < 800, isMobile: viewport.width < 600 });
  await ctx.addInitScript((t) => localStorage.setItem('learniq_token', t), token);
  const page = await ctx.newPage(); watch(page); await page.goto(url);
  return { ctx, page };
};
test.afterEach(() => { expect(errors, 'no page errors or renderer crashes').toEqual([]); errors.length = 0; });

/** Loudest sample (RMS, 0..1) of the REAL audio playing in the page's <audio> elements over `ms` (Web Audio analyser on the received stream). */
const measureAudio = (page: Page, ms = 4000) => page.evaluate(async (dur) => {
  const els = Array.from(document.querySelectorAll('audio')).filter((a) => (a as HTMLAudioElement).srcObject) as HTMLAudioElement[];
  if (!els.length) return { elements: 0, playing: 0, peak: 0 };
  const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
  const ctx = new AC();
  const analysers = els.map((a) => { const src = ctx.createMediaStreamSource(a.srcObject as MediaStream); const an = ctx.createAnalyser(); an.fftSize = 1024; src.connect(an); return an; });
  const buf = new Float32Array(1024); let peak = 0; const end = performance.now() + dur;
  while (performance.now() < end) {
    for (const an of analysers) { an.getFloatTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i += 1) s += buf[i] * buf[i]; peak = Math.max(peak, Math.sqrt(s / buf.length)); }
    await new Promise((r) => setTimeout(r, 40));
  }
  await ctx.close();
  return { elements: els.length, playing: els.filter((a) => !a.paused && a.readyState >= 2).length, peak };
}, ms);

const joinAsAdmin = async (browser: Browser, code: string, viewport = { width: 1280, height: 800 }) => {
  const ad = await open(browser, fx.admin.token, `/admin/live/${code}`, viewport);
  await expect(ad.page.getByTestId('admin-console')).toBeVisible();
  await ad.page.getByTestId('join-live-meeting').click();
  await expect(ad.page.getByTestId('live-room')).toBeVisible({ timeout: 20000 });
  return ad;
};

test('Admin joins the REAL room without approval, hears teacher + student, sees the teacher, speaks, moderates, leaves without ending, ends only via End class', async ({ browser }) => {
  const code = await newClass(); // the teacher approves every student - but never the admin
  const t = await open(browser, fx.teacher.token, `/live/${code}`);
  await expect(t.page.getByTestId('main-stage')).toBeVisible();
  await t.page.getByTestId('btn-cam').click(); await expect(t.page.getByTestId('btn-cam')).toHaveAttribute('aria-pressed', 'true');
  await t.page.getByTestId('btn-mic').click(); await expect(t.page.getByTestId('btn-mic')).toHaveAttribute('aria-pressed', 'true');
  const s = await open(browser, fx.students[0].token, `/live/${code}`, { width: 390, height: 844 });
  await expect(s.page.getByTestId('screen-waiting')).toBeVisible();
  await t.page.getByTestId('btn-people').click();
  await t.page.getByRole('button', { name: `Admit ${fx.students[0].name}` }).click();
  await t.page.keyboard.press('Escape');
  await expect(s.page.getByTestId('main-stage')).toHaveAttribute('data-stage-state', 'camera', { timeout: 20000 });
  await s.page.getByTestId('btn-mic').click(); await expect(s.page.getByTestId('btn-mic')).toHaveAttribute('aria-pressed', 'true');
  // sanity: the STUDENT really hears the teacher (so "the admin hears" below is measured against a working baseline)
  const studentHears = await measureAudio(s.page, 3500);
  expect(studentHears.playing, 'student audio element plays').toBeGreaterThan(0);
  expect(studentHears.peak, 'student hears the teacher (real signal)').toBeGreaterThan(0.005);

  // ── the admin dashboard: card with host, status, connected count and BOTH actions ──
  const dash = await open(browser, fx.admin.token, '/admin/live', { width: 1280, height: 800 });
  const row = dash.page.getByTestId(`live-row-${code}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText('LIVE');
  await expect(row).toContainText(/Host:\s*Nikhil/);
  await expect(row).toContainText('1 connected');
  await expect(dash.page.getByTestId(`open-console-${code}`)).toBeVisible();
  await expect(dash.page.getByTestId(`join-meeting-${code}`)).toHaveText(/Join Live Meeting/);
  // Open console still works and is clearly different from joining
  await dash.page.getByTestId(`open-console-${code}`).click();
  await expect(dash.page.getByTestId('admin-console')).toBeVisible();
  await expect(dash.page.getByText(/without joining it/)).toBeVisible();
  await expect(dash.page.getByTestId('console-refresh')).toContainText('Refresh');   // the formerly blank header button now has a visible icon + label
  const rb = (await dash.page.getByTestId('console-refresh').boundingBox())!; expect(rb.width).toBeGreaterThan(60);
  await dash.page.getByTestId('join-live-meeting').dblclick();                            // a double click must not create two connections
  await expect(dash.page).toHaveURL(new RegExp(`/admin/live/${code}/meeting`));
  await expect(dash.page.getByTestId('live-room')).toBeVisible({ timeout: 20000 });
  await expect(dash.page.getByTestId('admin-badge')).toContainText('Admin moderator');
  await expect(dash.page.getByTestId('admin-notice')).toContainText('Nothing is recorded');
  expect(await t.page.getByTestId('waiting-list').count(), 'no approval request reached the teacher').toBe(0);

  // everyone is told; the admin is identified in the roster; the teacher is still the host; the student count excludes the admin
  await expect(s.page.getByText(/LearnIQ Admin\) has joined the meeting as a moderator/)).toBeVisible({ timeout: 10000 });
  await t.page.getByTestId('btn-people').click();
  await expect(t.page.getByTestId('role-admin')).toHaveText('Admin Moderator');
  await expect(t.page.getByTestId('participants-panel')).toContainText(fx.admin.name);
  await t.page.keyboard.press('Escape');
  await expect(t.page.getByTestId('btn-people')).toBeVisible();

  // ── video: the admin sees the teacher's real camera on the main stage ──
  const stage = dash.page.getByTestId('main-stage');
  await expect(stage).toHaveAttribute('data-stage-state', 'camera', { timeout: 25000 });
  await expect.poll(() => stage.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth > 0 && !v.paused), { timeout: 15000 }).toBe(true);

  // ── audio (the critical one): the admin HEARS the teacher and the student - measured ──
  const heard = await measureAudio(dash.page, 4500);
  expect(heard.elements, 'one audio element per audible participant (teacher + student), never duplicates').toBe(2);
  expect(heard.playing, 'both are really playing').toBe(2);
  expect(heard.peak, 'a real audio signal reaches the admin').toBeGreaterThan(0.005);
  const dupes = await dash.page.evaluate(() => { const ids = Array.from(document.querySelectorAll('audio')).map((a) => (a.srcObject as MediaStream | null)?.id).filter(Boolean); return ids.length - new Set(ids).size; });
  expect(dupes, 'no stream is attached to two audio elements').toBe(0);

  // ── outgoing: the admin's microphone is OFF until they switch it on; then the teacher and the student hear the admin ──
  await expect(dash.page.getByTestId('btn-mic')).toHaveAttribute('aria-pressed', 'false');
  await t.page.getByTestId('btn-mic').click();                                                                  // teacher mutes so the admin's audio is the only source
  await s.page.getByTestId('btn-mic').click();
  await expect.poll(async () => (await measureAudio(s.page, 1500)).peak, { timeout: 12000 }).toBeLessThan(0.003);   // silence baseline
  await dash.page.getByTestId('btn-mic').click();
  await expect(dash.page.getByTestId('btn-mic')).toHaveAttribute('aria-pressed', 'true');
  expect((await measureAudio(s.page, 4000)).peak, 'the student hears the admin').toBeGreaterThan(0.005);
  expect((await measureAudio(t.page, 4000)).peak, 'the teacher hears the admin').toBeGreaterThan(0.005);
  await dash.page.getByTestId('btn-mic').click();                                                               // mute again
  await expect(dash.page.getByTestId('btn-mic')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await measureAudio(s.page, 1500)).peak, { timeout: 12000 }).toBeLessThan(0.003);

  // ── host-level moderation, with no teacher approval: lock admission; the SERVER state changes ──
  await dash.page.getByTestId('btn-people').click();
  await dash.page.getByTestId('lock-toggle').click();
  await expect(dash.page.getByTestId('lock-toggle')).toContainText('Admission locked');
  const late = await open(browser, fx.students[1].token, `/live/${code}`, { width: 390, height: 844 });
  await expect(late.page.getByTestId('screen-denied')).toBeVisible({ timeout: 15000 });                      // locked by the admin
  await dash.page.getByTestId('lock-toggle').click();
  await expect(dash.page.getByTestId('lock-toggle')).toContainText('Lock admission');
  await dash.page.keyboard.press('Escape');
  await late.ctx.close();

  // ── MCQ launched by the admin: students answer, the admin is never ranked; the existing 5 s rank card shows ──
  await dash.page.getByTestId('btn-more').click(); await dash.page.getByTestId('open-mcq').click();
  await dash.page.getByPlaceholder('Type your question').fill('What is 2 + 2?');
  await dash.page.getByLabel('Option A', { exact: true }).fill('3'); await dash.page.getByLabel('Option B', { exact: true }).fill('4');
  await dash.page.getByRole('button', { name: 'Remove option D' }).click(); await dash.page.getByRole('button', { name: 'Remove option C' }).click();
  await dash.page.getByLabel('Option B is correct').check();
  await dash.page.getByTestId('host-mcq-launch').click();
  await expect(s.page.getByTestId('mcq-popup')).toBeVisible({ timeout: 10000 });
  await expect(dash.page.getByTestId('mcq-popup')).toHaveCount(0);                                              // the moderator never gets the student popup
  await s.page.getByTestId('mcq-option-1').click(); await s.page.getByTestId('mcq-submit').click();
  await expect(s.page.getByTestId('mcq-popup')).toHaveCount(0, { timeout: 3000 });
  const card = s.page.getByTestId('rank-card'); await expect(card).toBeVisible({ timeout: WINDOW_MS + 4000 });
  await expect(s.page.getByTestId('rank-row-1')).toContainText(fx.students[0].name.split(' ')[0]);
  await expect(card).not.toContainText(fx.admin.name);
  await expect(card).toHaveCount(0, { timeout: RANK_MS + 3000 });
  await dash.page.getByRole('button', { name: 'Close panel' }).click();

  // ── navigation: the console and the meeting never leave a duplicate connection ──
  await dash.page.getByTestId('btn-more').click(); await dash.page.getByTestId('back-to-console').click();
  await expect(dash.page.getByTestId('admin-console')).toBeVisible({ timeout: 15000 });
  await expect(s.page.getByText(/LearnIQ Admin\) left the meeting/)).toBeVisible({ timeout: 10000 });
  await t.page.getByRole('button', { name: 'Close panel' }).click().catch(() => {});   // the teacher sees the same question panel
  await t.page.getByTestId('btn-people').click();
  await expect(t.page.getByTestId('participants-panel')).not.toContainText(fx.admin.name);
  await t.page.keyboard.press('Escape');
  await expect(s.page.getByTestId('main-stage')).toBeVisible();                                                  // the class carried on
  await dash.page.getByTestId('join-live-meeting').click();
  await expect(dash.page.getByTestId('live-room')).toBeVisible({ timeout: 20000 });

  // ── Leave is NOT End: the admin leaves, teacher and student stay, the class is still live ──
  await dash.page.getByTestId('btn-leave').click();
  await expect(dash.page.getByTestId('admin-console')).toBeVisible({ timeout: 15000 });
  await expect(s.page.getByTestId('main-stage')).toBeVisible();
  await expect(t.page.getByTestId('main-stage')).toBeVisible();
  await expect(s.page.getByTestId('screen-ended')).toHaveCount(0);
  const stillLive = await api('GET', '/admin/live-classes?status=live', fx.admin.token);
  expect(stillLive.json.classes.some((c: any) => c.sessionCode === code && c.status === 'live')).toBe(true);

  // ── End class is a separate, confirmed control ──
  await dash.page.getByTestId('join-live-meeting').click();
  await expect(dash.page.getByTestId('live-room')).toBeVisible({ timeout: 20000 });
  await dash.page.getByTestId('btn-more').click();
  await dash.page.getByTestId('end-class').click();
  await expect(s.page.getByTestId('screen-ended')).toHaveCount(0);                                              // nothing happens before the confirmation
  await dash.page.getByTestId('confirm-end').click();
  await expect(s.page.getByTestId('screen-ended').or(s.page.getByTestId('podium'))).toBeVisible({ timeout: 15000 });
  await expect(t.page.getByTestId('screen-ended').or(t.page.getByTestId('podium'))).toBeVisible({ timeout: 15000 });
  await expect(dash.page.getByTestId('screen-ended').or(dash.page.getByTestId('podium'))).toBeVisible({ timeout: 15000 });
  const audit = await api('GET', `/admin/live-classes/${code}/audit`, fx.admin.token);
  const actions = audit.json.entries.map((e: any) => e.action);
  for (const a of ['MEETING_JOIN', 'MEETING_LEAVE', 'ADMISSION_LOCK', 'ADMISSION_UNLOCK', 'MCQ_LAUNCH', 'MEETING_END']) expect(actions, `audited: ${a}`).toContain(a);
  await t.ctx.close(); await s.ctx.close(); await dash.ctx.close();
});

test('Security: a student or a teacher cannot reach the admin meeting screen, and no one but an admin gets an admin join over HTTP', async ({ browser }) => {
  const code = await newClass({ requireApproval: false });
  for (const who of [fx.students[2], fx.teacher]) {
    const p = await open(browser, who.token, `/admin/live/${code}/meeting`);
    await expect(p.page.getByTestId('admin-badge')).toHaveCount(0, { timeout: 8000 });
    await expect(p.page).not.toHaveURL(new RegExp('/meeting$'), { timeout: 8000 });
    await p.ctx.close();
  }
  expect((await api('POST', `/admin/live-classes/${code}/join`, fx.students[2].token)).status).toBe(403);
  expect((await api('POST', `/admin/live-classes/${code}/join`, fx.teacher.token)).status).toBe(403);
  expect((await api('POST', `/admin/live-classes/${code}/join`, fx.admin.token)).status).toBe(200);
  // an admin who opens the ordinary student link still goes to the console (existing behaviour kept)
  const via = await open(browser, fx.admin.token, `/live/${code}`);
  await expect(via.page).toHaveURL(new RegExp(`/admin/live/${code}$`), { timeout: 15000 });
  await via.ctx.close();
});

test('Dashboard: Join Live Meeting is offered only for live classes; a class nobody runs has it disabled; an ended class cannot be joined', async ({ browser }) => {
  const code = await newClass({ requireApproval: false });
  const t = await open(browser, fx.teacher.token, `/live/${code}`);                       // the teacher is really in the room, so the class is "running"
  await expect(t.page.getByTestId('main-stage')).toBeVisible();
  const ghost = await newClass({ requireApproval: false });                                  // started but nobody ever connected: not running
  const dash = await open(browser, fx.admin.token, '/admin/live');
  await expect(dash.page.getByTestId(`join-meeting-${code}`)).toBeEnabled({ timeout: 15000 });
  await expect(dash.page.getByTestId(`join-meeting-${ghost}`)).toBeDisabled();
  await dash.ctx.close(); await t.ctx.close();
  // end it, then try to join by URL: a clear message, not a broken screen
  const list = await api('GET', '/admin/live-classes?status=live', fx.admin.token);
  const id = list.json.classes.find((c: any) => c.sessionCode === code).id;
  await api('POST', `/teacher/live-sessions/${id}/end`, fx.teacher.token);
  const j = await open(browser, fx.admin.token, `/admin/live/${code}/meeting`);
  await expect(j.page.getByTestId('screen-ended')).toBeVisible({ timeout: 15000 });
  await expect(j.page.getByTestId('screen-ended')).toContainText(/ended/i);
  await j.ctx.close();
});

for (const vp of [
  { name: '320', width: 320, height: 640 }, { name: '360', width: 360, height: 740 }, { name: '375', width: 375, height: 667 }, { name: '390', width: 390, height: 844 },
  { name: '430', width: 430, height: 932 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'desktop', width: 1280, height: 800 },
]) {
  test(`Admin meeting layout @${vp.name}: stage first, chat secondary, controls reachable, no overflow`, async ({ browser }) => {
    const code = await newClass({ requireApproval: false });
    const t = await open(browser, fx.teacher.token, `/live/${code}`);
    await t.page.getByTestId('btn-cam').click(); await expect(t.page.getByTestId('btn-cam')).toHaveAttribute('aria-pressed', 'true');
    const ad = await joinAsAdmin(browser, code, { width: vp.width, height: vp.height });
    const stage = ad.page.getByTestId('main-stage');
    await expect(stage).toHaveAttribute('data-stage-state', 'camera', { timeout: 25000 });
    const box = (await stage.boundingBox())!;
    expect(box.width).toBeGreaterThan(vp.width * 0.8); expect(box.height).toBeGreaterThan(vp.height * 0.2);
    await expect(ad.page.getByTestId('chat-panel')).toHaveCount(0);
    const rep = await findOverflow(ad.page); expect(rep.offenders, JSON.stringify(rep.offenders)).toEqual([]);
    for (const b of await ad.page.getByTestId('control-bar').getByRole('button').all()) { const bb = await b.boundingBox(); if (bb) { expect(bb.width).toBeGreaterThanOrEqual(44); expect(bb.height).toBeGreaterThanOrEqual(44); } }
    await ad.page.getByTestId('btn-chat').click();
    const chat = ad.page.getByTestId('chat-panel'); await expect(chat).toBeVisible();
    expect((await findOverflow(ad.page)).offenders).toEqual([]);
    await chat.getByRole('button', { name: 'Close chat' }).click();
    // the moderator controls live in "More" and stay inside the screen
    await ad.page.getByTestId('btn-more').click();
    for (const id of ['back-to-console', 'open-mcq', 'open-settings', 'end-class']) {
      const bb = (await ad.page.getByTestId(id).boundingBox())!;
      expect(bb.x).toBeGreaterThanOrEqual(-1); expect(bb.x + bb.width).toBeLessThanOrEqual(vp.width + 1); expect(bb.height).toBeGreaterThanOrEqual(44);
    }
    await ad.page.keyboard.press('Escape');
    await t.ctx.close(); await ad.ctx.close();
  });
}

test('Browser autoplay policy: when the browser blocks automatic sound, a clear "enable audio" action appears and starts the class audio', async () => {
  // a browser WITHOUT the autoplay override: opening the meeting URL directly (no click on the site first) is a blocked-autoplay situation
  const strict = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=document-user-activation-required'] });
  try {
    const code = await newClass({ requireApproval: false });
    const t = await open(strict, fx.teacher.token, `/live/${code}`);
    await t.page.getByTestId('btn-mic').click(); await expect(t.page.getByTestId('btn-mic')).toHaveAttribute('aria-pressed', 'true');
    // Headless Chromium lets MediaStream audio start by itself, so the browser's refusal is SIMULATED faithfully: play() rejects with
    // NotAllowedError (exactly what Safari / mobile Chrome do) until the person interacts with the page.
    const ctx = await strict.newContext({ permissions: ['camera', 'microphone'] });
    await ctx.addInitScript((tok) => {
      localStorage.setItem('learniq_token', tok);
      let unlocked = false; const orig = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) { return unlocked ? orig.call(this) : Promise.reject(new DOMException('play() failed: user gesture required', 'NotAllowedError')); };
      window.addEventListener('pointerdown', () => { unlocked = true; }, true);
    }, fx.admin.token);
    const ad = { ctx, page: await ctx.newPage() }; watch(ad.page); await ad.page.goto(`/admin/live/${code}/meeting`);
    await expect(ad.page.getByTestId('live-room')).toBeVisible({ timeout: 20000 });
    await expect(ad.page.getByTestId('enable-audio')).toBeVisible({ timeout: 25000 });
    await ad.page.getByTestId('enable-audio').click();
    await expect(ad.page.getByTestId('enable-audio')).toHaveCount(0, { timeout: 8000 });
    const heard = await measureAudio(ad.page, 4000);
    expect(heard.playing, 'the element really plays after the click').toBeGreaterThan(0);
    expect(heard.peak).toBeGreaterThan(0.005);
    await t.ctx.close(); await ad.ctx.close();
  } finally { await strict.close(); }
});
