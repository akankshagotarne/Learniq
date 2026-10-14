import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

/**
 * Teacher interview room - media lifecycle and failure handling, in REAL Chromium with the REAL signalling server and REAL
 * WebRTC (Chromium's fake capture devices). Device failures are injected by wrapping navigator.mediaDevices in an init script;
 * everything else (React hook, socket layer, backend authorisation) is the production code.
 * It does NOT reproduce a physical-camera / driver crash (STATUS_ACCESS_VIOLATION) - that cannot be produced from a fake device.
 */
type Fixture = { base: string; examId: string; teacher: { token: string }; teacher2: { token: string }; student: { token: string } };
let harness: ChildProcess; let fx: Fixture; let interviewId: string;

test.beforeAll(async () => {
  const cwd = path.resolve(process.cwd(), '..', 'backend');
  harness = spawn('node', ['src/tests/helpers/interviewHarness.js', '5055'], { cwd, stdio: ['ignore', 'pipe', 'inherit'] });
  fx = await new Promise<Fixture>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('harness did not start')), 20000);
    harness.stdout!.on('data', (d: Buffer) => { const line = d.toString().split('\n').find((l) => l.startsWith('READY ')); if (line) { clearTimeout(t); resolve(JSON.parse(line.slice(6))); } });
    harness.on('exit', () => reject(new Error('harness exited')));
  });
  const req = await api('POST', '/request', fx.student.token, { examId: fx.examId });
  interviewId = req.json.interview._id;
  expect((await api('POST', `/${interviewId}/accept`, fx.teacher.token)).json.interview.status).toBe('APPROVED');
});
test.afterAll(() => { harness?.kill(); });

const api = async (method: string, url: string, token: string, body?: unknown) => {
  const res = await fetch(`${fx.base}/api/interviews${url}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

type Mode = 'ok' | 'hang' | 'deny-video' | 'deny-audio' | 'busy';
const instrument = (ctx: BrowserContext, mode: Mode = 'ok', devices: 'all' | 'no-cam' | 'no-mic' = 'all') => ctx.addInitScript(([m, d]) => {
  const w = window as any; w.__mode = m; w.__devices = d; w.__gum = { calls: 0, streams: [] as MediaStream[] }; w.__pc = 0;
  const md = navigator.mediaDevices; const orig = md.getUserMedia.bind(md);
  md.getUserMedia = (c?: MediaStreamConstraints) => {
    w.__gum.calls += 1;
    const err = (n: string) => Promise.reject(new DOMException('injected', n));
    if (w.__mode === 'hang') return new Promise<MediaStream>(() => {});
    if (w.__mode === 'busy') return err('NotReadableError');
    if (w.__mode === 'deny-video' && c && c.video) return err('NotAllowedError');
    if (w.__mode === 'deny-audio' && c && c.audio) return err('NotAllowedError');
    return orig(c).then((s) => { w.__gum.streams.push(s); return s; });
  };
  const od = md.enumerateDevices.bind(md);
  md.enumerateDevices = async () => { const l = await od(); return l.filter((x) => !(w.__devices === 'no-cam' && x.kind === 'videoinput') && !(w.__devices === 'no-mic' && x.kind === 'audioinput')); };
  const RPC = window.RTCPeerConnection;
  const Counting = function (this: unknown, ...a: ConstructorParameters<typeof RTCPeerConnection>) { w.__pc += 1; return new RPC(...a); } as unknown as typeof RTCPeerConnection;
  Counting.prototype = RPC.prototype; window.RTCPeerConnection = Counting;
  w.__live = () => w.__gum.streams.reduce((n: number, s: MediaStream) => n + s.getTracks().filter((t) => t.readyState === 'live').length, 0);
}, [mode, devices] as const);

/** every page error / renderer crash in a test is a failure */
const watch = (page: Page, sink: string[]) => { page.on('pageerror', (e) => sink.push(`pageerror: ${e.message}`)); page.on('crash', () => sink.push('renderer crash')); };
const stats = (page: Page) => page.evaluate(() => ({ gum: (window as any).__gum.calls as number, live: (window as any).__live() as number, pc: (window as any).__pc as number }));
const phase = (page: Page) => page.getByTestId('interview-room');
const open = async (ctx: BrowserContext, token: string, url: string, sink: string[]) => {
  await ctx.addInitScript((t) => localStorage.setItem('learniq_token', t), token);
  const page = await ctx.newPage(); watch(page, sink); await page.goto(url); return page;
};
const hasRemoteVideo = (page: Page) => expect.poll(() => page.evaluate(() => { const v = document.querySelector('[data-testid="remote-video"]') as HTMLVideoElement | null; return !!v && v.videoWidth > 0 && v.readyState >= 2 && !v.paused; }), { timeout: 30_000 }).toBe(true);
const T = () => `/teacher/interview/${interviewId}`;

test('permission granted: finite init, ONE camera request, ONE room-access call, ONE peer connection - no loop while idle', async ({ browser }) => {
  const errs: string[] = []; const ctx = await browser.newContext(); await instrument(ctx);
  let roomAccess = 0; ctx.on('request', (r) => { if (r.url().endsWith('/room-access')) roomAccess += 1; });
  const teacher = await open(ctx, fx.teacher.token, T(), errs);
  await expect(phase(teacher)).toHaveAttribute('data-phase', 'waiting-peer', { timeout: 15_000 });
  await expect(teacher.getByTestId('camera-status')).toHaveText('Camera: ready');
  await expect(teacher.getByTestId('mic-status')).toHaveText('Microphone: ready');
  await expect(teacher.getByTestId('local-video')).toBeVisible();
  expect(await teacher.evaluate(() => { const v = document.querySelector('[data-testid="local-video"]') as HTMLVideoElement; return v.videoWidth > 0 && !v.paused; })).toBe(true); // local preview really renders
  await teacher.waitForTimeout(8000); // longer than the 6 s status poll: nothing may re-initialise
  const s = await stats(teacher);
  expect(s.gum).toBe(1); expect(roomAccess).toBe(1); expect(s.pc).toBe(0); // student not here yet -> no peer connection
  // teacher waits stably while the student has not joined (placeholder says so; no fake "Camera off"/connected state)
  await expect(teacher.getByTestId('remote-video-placeholder')).toContainText('Waiting for Student One to join');
  await expect(teacher.getByTestId('connection-status')).toContainText('waiting for the other person');
  expect(errs).toEqual([]); await ctx.close();
});

test('student joins AFTER the teacher: real remote video + audio appear without a reload; mic/camera toggles reach the peer', async ({ browser }) => {
  const errs: string[] = []; const tCtx = await browser.newContext(); const sCtx = await browser.newContext(); await instrument(tCtx); await instrument(sCtx);
  const teacher = await open(tCtx, fx.teacher.token, T(), errs);
  await expect(phase(teacher)).toHaveAttribute('data-phase', 'waiting-peer', { timeout: 15_000 });
  const student = await open(sCtx, fx.student.token, `/student/interview/${interviewId}`, errs);
  await hasRemoteVideo(teacher); await hasRemoteVideo(student);
  await expect(phase(teacher)).toHaveAttribute('data-phase', 'connected', { timeout: 30_000 });
  // remote audio really arrives
  expect(await teacher.evaluate(() => { const v = document.querySelector('[data-testid="remote-video"]') as HTMLVideoElement; return (v.srcObject as MediaStream).getAudioTracks().length; })).toBe(1);
  await teacher.waitForTimeout(8000); // an idle, healthy call must not churn connections
  expect((await stats(teacher)).pc).toBeLessThanOrEqual(1); expect((await stats(student)).pc).toBeLessThanOrEqual(1);
  expect((await stats(teacher)).gum).toBe(1);
  await teacher.getByRole('button', { name: /Mute microphone/ }).click();
  await expect(student.getByText('Muted')).toBeVisible();
  await teacher.getByRole('button', { name: /Turn camera off/ }).click();
  await expect(student.getByTestId('remote-video-placeholder')).toContainText('Camera off');
  await teacher.getByRole('button', { name: /Turn camera on/ }).click();
  await teacher.getByRole('button', { name: /Unmute microphone/ }).click();

  // the student leaves and comes back (allowed while the interview is running): the teacher goes back to waiting, then reconnects
  await student.close();
  await expect(phase(teacher)).toHaveAttribute('data-phase', 'waiting-peer', { timeout: 20_000 });
  const again = await sCtx.newPage(); watch(again, errs); await again.goto(`/student/interview/${interviewId}`);
  await hasRemoteVideo(again); await hasRemoteVideo(teacher);
  await expect(phase(teacher)).toHaveAttribute('data-phase', 'connected', { timeout: 30_000 });

  // the teacher's page is reloaded mid-call: session state stays valid, the old camera is released, nothing is duplicated
  await teacher.reload();
  await hasRemoteVideo(teacher); await expect(phase(teacher)).toHaveAttribute('data-phase', 'connected', { timeout: 30_000 });
  expect((await stats(teacher)).gum).toBe(1);
  const detail = await api('GET', `/${interviewId}`, fx.teacher.token);
  expect(['APPROVED', 'CONNECTING', 'IN_PROGRESS']).toContain(detail.json.interview.status);
  expect(errs).toEqual([]); await tCtx.close(); await sCtx.close();
});

test('camera permission denied -> camera-specific message, no crash, Try again recovers', async ({ browser }) => {
  const errs: string[] = []; const ctx = await browser.newContext(); await instrument(ctx, 'deny-video');
  const teacher = await open(ctx, fx.teacher.token, T(), errs);
  const box = teacher.getByTestId('room-media-error');
  await expect(box).toContainText('Camera needed'); await expect(box).toContainText('Unable to access your camera');
  expect((await stats(teacher)).live).toBe(0); // the microphone probe stream was released
  await teacher.evaluate(() => { (window as any).__mode = 'ok'; });
  await box.getByRole('button', { name: /Try again/ }).click();
  await expect(phase(teacher)).toHaveAttribute('data-phase', 'waiting-peer', { timeout: 15_000 });
  expect(errs).toEqual([]); await ctx.close();
});

test('microphone permission denied -> microphone-specific message', async ({ browser }) => {
  const errs: string[] = []; const ctx = await browser.newContext(); await instrument(ctx, 'deny-audio');
  const teacher = await open(ctx, fx.teacher.token, T(), errs);
  await expect(teacher.getByTestId('room-media-error')).toContainText('Microphone needed');
  await expect(teacher.getByTestId('room-media-error')).toContainText('microphone');
  expect((await stats(teacher)).live).toBe(0); expect(errs).toEqual([]); await ctx.close();
});

test('no camera / no microphone device: reported at once, getUserMedia is never called', async ({ browser }) => {
  for (const [devices, text] of [['no-cam', 'No camera was found'], ['no-mic', 'No microphone was found']] as const) {
    const errs: string[] = []; const ctx = await browser.newContext(); await instrument(ctx, 'ok', devices);
    const teacher = await open(ctx, fx.teacher.token, T(), errs);
    await expect(teacher.getByTestId('room-media-error')).toContainText(text);
    expect((await stats(teacher)).gum).toBe(0); expect(errs).toEqual([]); await ctx.close();
  }
});

test('device already in use -> clear "busy" message, finite number of attempts (no initialisation loop)', async ({ browser }) => {
  const errs: string[] = []; const ctx = await browser.newContext(); await instrument(ctx, 'busy');
  const teacher = await open(ctx, fx.teacher.token, T(), errs);
  await expect(teacher.getByTestId('room-media-error')).toContainText('being used by another app');
  await teacher.waitForTimeout(3000);
  expect((await stats(teacher)).gum).toBe(3); // the combined request + one probe per device, then it stops
  expect(errs).toEqual([]); await ctx.close();
});

test('getUserMedia never answers: waiting-for-permission state, then a defined timeout error - never stuck on "Checking…"; Try again works', async ({ browser }) => {
  const errs: string[] = []; const ctx = await browser.newContext(); await instrument(ctx, 'hang');
  const teacher = await open(ctx, fx.teacher.token, T(), errs);
  await teacher.clock.install();
  await expect(phase(teacher)).toHaveAttribute('data-phase', /preparing|awaiting-permission/, { timeout: 15_000 });
  await teacher.clock.fastForward(2_000);
  await expect(phase(teacher)).toHaveAttribute('data-phase', 'awaiting-permission');
  await expect(teacher.getByText(/Waiting for camera and microphone permission/)).toBeVisible();
  await teacher.clock.fastForward(50_000);
  await expect(teacher.getByTestId('room-media-error')).toContainText('did not respond in time');
  await teacher.evaluate(() => { (window as any).__mode = 'ok'; });
  await teacher.getByTestId('room-media-error').getByRole('button', { name: /Try again/ }).click();
  await expect(phase(teacher)).toHaveAttribute('data-phase', 'waiting-peer', { timeout: 15_000 });
  expect(errs).toEqual([]); await ctx.close();
});

test('room-token failures: server error and refused access end in a clear error with ONE request (no retry loop)', async ({ browser }) => {
  for (const [status, body, text] of [[500, { success: false }, 'You cannot join this interview right now'], [403, { success: false, message: 'This interview is not available to you.' }, 'This interview is not available to you.']] as const) {
    const errs: string[] = []; const ctx = await browser.newContext(); await instrument(ctx);
    let calls = 0;
    await ctx.route('**/room-access', (r) => { calls += 1; return r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }); });
    const teacher = await open(ctx, fx.teacher.token, T(), errs);
    await expect(teacher.getByTestId('room-error')).toContainText(text);
    await teacher.waitForTimeout(7000);
    expect(calls).toBe(1); expect((await stats(teacher)).gum).toBe(0); // no camera is requested for someone who is not authorised
    expect(errs).toEqual([]); await ctx.close();
  }
});

test('signalling server unreachable: the join times out into a clear connection error and the camera is released', async ({ browser }) => {
  const errs: string[] = []; const ctx = await browser.newContext(); await instrument(ctx);
  await ctx.route('**/socket.io/**', (r) => r.abort());
  await ctx.routeWebSocket(/socket\.io/, () => { /* accept the upgrade but never answer the handshake: the signalling server is unreachable */ });
  const teacher = await open(ctx, fx.teacher.token, T(), errs);
  await teacher.clock.install();
  await expect(phase(teacher)).toHaveAttribute('data-phase', 'joining', { timeout: 15_000 });
  await teacher.clock.fastForward(15_000);
  await expect(teacher.getByTestId('room-error')).toContainText('did not answer in time');
  expect(errs).toEqual([]); await ctx.close();
});

test('repeated page entry and exit leaks nothing: every exit stops the camera, every entry makes exactly one request', async ({ browser }) => {
  const errs: string[] = []; const ctx = await browser.newContext(); await instrument(ctx);
  const teacher = await open(ctx, fx.teacher.token, T(), errs);
  await expect(phase(teacher)).toHaveAttribute('data-phase', 'waiting-peer', { timeout: 15_000 });
  for (let i = 1; i <= 5; i++) {
    await teacher.getByRole('link', { name: /Back to Interview/ }).click();          // in-app navigation: the room unmounts
    await expect(phase(teacher)).toHaveCount(0);
    await expect.poll(async () => (await stats(teacher)).live).toBe(0);              // camera + microphone released
    await teacher.goBack();                                                          // and the room mounts again
    await expect(phase(teacher)).toHaveAttribute('data-phase', 'waiting-peer', { timeout: 15_000 });
    expect((await stats(teacher)).gum).toBe(i + 1);
  }
  expect((await stats(teacher)).live).toBe(2);
  await teacher.getByRole('link', { name: /Back to Interview/ }).click();
  await expect.poll(async () => (await stats(teacher)).live).toBe(0);
  expect(errs).toEqual([]); await ctx.close();
});

test('End Interview & Evaluate: evaluation stays reachable, a repeated end does not create a conflicting state, the call closes for the student', async ({ browser }) => {
  const errs: string[] = []; const tCtx = await browser.newContext(); const sCtx = await browser.newContext(); await instrument(tCtx); await instrument(sCtx);
  const teacher = await open(tCtx, fx.teacher.token, T(), errs);
  const student = await open(sCtx, fx.student.token, `/student/interview/${interviewId}`, errs);
  await hasRemoteVideo(teacher); await hasRemoteVideo(student);
  await teacher.getByTestId('end-interview').click();
  await teacher.getByTestId('confirm-end').click();
  await expect(teacher.getByTestId('evaluation-form')).toBeVisible({ timeout: 20_000 });
  await expect(student.getByTestId('interview-status')).toHaveText('Evaluation Pending', { timeout: 20_000 });
  await expect(student.getByTestId('interview-room')).toHaveCount(0);
  await expect.poll(async () => (await stats(teacher)).live).toBe(0);
  await expect.poll(async () => (await stats(student)).live).toBe(0);
  // ending again (double click / retried request / second tab) is harmless
  const again = await api('POST', `/${interviewId}/end`, fx.teacher.token);
  expect([200, 409]).toContain(again.status);
  const detail = await api('GET', `/${interviewId}`, fx.teacher.token);
  expect(detail.json.interview.status).toBe('EVALUATION_PENDING');
  await teacher.reload(); await expect(teacher.getByTestId('evaluation-form')).toBeVisible();      // reload keeps the evaluation reachable
  await expect(teacher.getByTestId('interview-room')).toHaveCount(0);
  expect(errs).toEqual([]); await tCtx.close(); await sCtx.close();
});
