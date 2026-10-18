import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

/**
 * Switch Camera in a LIVE interview: two real Chromium browsers, real WebRTC, the real signalling server, Chromium's TWO fake
 * capture camera presented as TWO cameras (see `instrument`). Proves, for the teacher AND the student: the swap uses the existing sender
 * (still ONE RTCPeerConnection, no renegotiation, same audio track, same sender count), the other side keeps receiving moving
 * video, the other participant's camera is untouched, the camera stays off when it was off, and ending the interview releases
 * every camera. It does NOT prove behaviour on physical phones (front/rear facingMode) - that logic is unit-tested with fakes.
 */
type Fixture = { base: string; examId: string; teacher: { token: string }; student: { token: string }; student2: { token: string }; student3: { token: string }; teacher2: { token: string } };
let harness: ChildProcess; let fx: Fixture; let interviewId: string;

/*
 * Why two ALIASES of one fake camera instead of Chromium's second fake device (--use-fake-device-for-media-stream=device-count=2):
 * with that second device, even a plain RTCRtpSender.replaceTrack() (no LearnIQ code at all) leaves the sender with no outgoing
 * frames in headless Chromium, while replacing with a canvas track or a fresh capture of the SAME fake device keeps video flowing -
 * a limitation of that fake device, not of the app. The aliases give the app two enumerable cameras with different deviceIds and
 * a genuinely new capture track per switch, over the real WebRTC pipeline.
 */
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] } });

const api = async (method: string, url: string, token: string, body?: unknown) => {
  const res = await fetch(`${fx.base}/api/interviews${url}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};
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

/** count peer connections, keep a handle on them, and remember every camera stream so leaks are visible */
const instrument = (ctx: BrowserContext) => ctx.addInitScript(() => {
  const w = window as any; w.__pcs = [] as RTCPeerConnection[]; w.__streams = [] as MediaStream[]; w.__renegotiations = 0;
  const RPC = window.RTCPeerConnection;
  const Counting = function (this: unknown, ...a: ConstructorParameters<typeof RTCPeerConnection>) { const pc = new RPC(...a); w.__pcs.push(pc); pc.addEventListener('negotiationneeded', () => { w.__renegotiations += 1; }); return pc; } as unknown as typeof RTCPeerConnection;
  Counting.prototype = RPC.prototype; window.RTCPeerConnection = Counting;
  const md = navigator.mediaDevices; const orig = md.getUserMedia.bind(md); const origEnum = md.enumerateDevices.bind(md);
  w.__tracks = [] as MediaStreamTrack[]; let realCam = '';
  md.enumerateDevices = async () => { // present the single fake camera as two cameras: real + alias
    const list = await origEnum(); const out: MediaDeviceInfo[] = []; let seen = false;
    for (const d of list) { if (d.kind !== 'videoinput') { out.push(d); continue; } if (seen) continue; seen = true; realCam = d.deviceId; out.push(d); out.push({ ...d.toJSON(), kind: 'videoinput', deviceId: 'alias-cam', label: 'Alias camera', toJSON: () => d.toJSON() } as MediaDeviceInfo); }
    return out;
  };
  md.getUserMedia = async (c?: MediaStreamConstraints) => {
    const v: any = c && c.video && typeof c.video === 'object' ? c.video : null; const wanted = v && v.deviceId && v.deviceId.exact;
    let alias = false; let cc = c;
    if (wanted === 'alias-cam') { alias = true; if (!realCam) await md.enumerateDevices(); cc = { ...c, video: { ...v, deviceId: { exact: realCam } } }; }
    const s = await orig(cc);
    s.getVideoTracks().forEach((t) => { const gs = t.getSettings.bind(t); t.getSettings = () => ({ ...gs(), deviceId: alias ? 'alias-cam' : gs().deviceId }); w.__tracks.push(t); });
    s.getAudioTracks().forEach((t) => w.__tracks.push(t));
    w.__streams.push(s); return s;
  };
});
const open = async (ctx: BrowserContext, token: string, url: string, errs: string[]) => {
  await ctx.addInitScript((t) => localStorage.setItem('learniq_token', t), token);
  const page = await ctx.newPage(); page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`)); page.on('crash', () => errs.push('crash')); await page.goto(url); return page;
};
const info = (page: Page) => page.evaluate(() => {
  const w = window as any; const pcs: RTCPeerConnection[] = w.__pcs;
  const pc = pcs[pcs.length - 1]; const senders = pc ? pc.getSenders() : [];
  const v = senders.find((s) => s.track && s.track.kind === 'video'); const a = senders.find((s) => s.track && s.track.kind === 'audio');
  const local = document.querySelector('[data-testid="local-video"]') as HTMLVideoElement;
  const localTrack = (local.srcObject as MediaStream | null)?.getVideoTracks()[0];
  return {
    pcCount: pcs.length, renegotiations: w.__renegotiations as number, senders: senders.length,
    sentCam: v?.track?.getSettings().deviceId as string | undefined, sentVideoId: v?.track?.id, sentAudioId: a?.track?.id, audioLive: a?.track?.readyState === 'live' && a.track.enabled,
    previewCam: localTrack?.getSettings().deviceId as string | undefined, previewTracks: (local.srcObject as MediaStream | null)?.getTracks().length ?? 0,
    liveCameraTracks: (w.__tracks as MediaStreamTrack[]).filter((t) => t.kind === 'video' && t.readyState === 'live').length,
    liveAudioTracks: (w.__tracks as MediaStreamTrack[]).filter((t) => t.kind === 'audio' && t.readyState === 'live').length,
  };
});
/** the REMOTE <video> keeps showing moving frames: the decoded frame counter keeps growing */
const remoteMoving = async (page: Page) => {
  const frames = () => page.evaluate(() => { const v = document.querySelector('[data-testid="remote-video"]') as HTMLVideoElement; return v.getVideoPlaybackQuality().totalVideoFrames; });
  const a = await frames(); await page.waitForTimeout(1500); const b = await frames(); return b > a;
};
const connected = async (...pages: Page[]) => { for (const p of pages) await expect(p.getByTestId('interview-room')).toHaveAttribute('data-phase', 'connected', { timeout: 30_000 }); };

const bothConnected = async (browser: any, errs: string[]) => {
  const tCtx = await browser.newContext({ permissions: ['camera', 'microphone'] }); const sCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
  await instrument(tCtx); await instrument(sCtx);
  const teacher = await open(tCtx, fx.teacher.token, `/teacher/interview/${interviewId}`, errs);
  const student = await open(sCtx, fx.student.token, `/student/interview/${interviewId}`, errs);
  await connected(teacher, student);
  await expect(teacher.getByTestId('switch-camera')).toBeEnabled({ timeout: 15_000 }); await expect(student.getByTestId('switch-camera')).toBeEnabled({ timeout: 15_000 });
  return { tCtx, sCtx, teacher, student };
};

test('switch camera works for the STUDENT and for the TEACHER, independently, repeatedly, without touching the call', async ({ browser }) => {
  const errs: string[] = []; const { tCtx, sCtx, teacher, student } = await bothConnected(browser, errs);
  const t0 = await info(teacher); const s0 = await info(student);
  expect(t0.pcCount).toBe(1); expect(s0.pcCount).toBe(1);
  expect(await remoteMoving(teacher)).toBe(true); expect(await remoteMoving(student)).toBe(true);

  // 1) STUDENT switches
  await student.getByTestId('switch-camera').click();
  await expect.poll(async () => (await info(student)).sentCam, { timeout: 15_000 }).not.toBe(s0.sentCam);
  const s1 = await info(student);
  expect(s1.previewCam).toBe(s1.sentCam);                      // the local preview shows what is being sent
  expect(s1.pcCount).toBe(1); expect(s1.renegotiations).toBe(s0.renegotiations); expect(s1.senders).toBe(s0.senders); // same connection, same senders, no renegotiation
  expect(s1.sentAudioId).toBe(s0.sentAudioId); expect(s1.audioLive).toBe(true);                                     // microphone untouched
  await expect.poll(async () => (await info(student)).liveCameraTracks, { timeout: 5000 }).toBe(1); // the old camera was released (right after the swap)
  expect(await remoteMoving(teacher)).toBe(true);              // the teacher keeps receiving the student's (new) video
  const t1 = await info(teacher);
  expect(t1.sentCam).toBe(t0.sentCam); expect(t1.previewCam).toBe(t0.previewCam); // the teacher's own camera is untouched
  await expect(student.getByTestId('camera-status')).toHaveText('Camera: ready');
  await expect(student.getByTestId('switch-camera')).toBeEnabled();

  // 2) TEACHER switches
  await teacher.getByTestId('switch-camera').click();
  await expect.poll(async () => (await info(teacher)).sentCam, { timeout: 15_000 }).not.toBe(t0.sentCam);
  const t2 = await info(teacher);
  expect(t2.previewCam).toBe(t2.sentCam); expect(t2.pcCount).toBe(1); expect(t2.renegotiations).toBe(t0.renegotiations); expect(t2.sentAudioId).toBe(t0.sentAudioId); expect(t2.audioLive).toBe(true);
  expect(await remoteMoving(student)).toBe(true);
  expect((await info(student)).sentCam).toBe(s1.sentCam);      // the student's camera is untouched by the teacher's switch

  // 3) repeated switching on both sides: no duplicate tracks, no extra connections
  for (let i = 0; i < 4; i += 1) {
    const before = (await info(student)).sentCam;
    await student.getByTestId('switch-camera').click();
    await expect.poll(async () => (await info(student)).sentCam, { timeout: 15_000 }).not.toBe(before);
    const beforeT = (await info(teacher)).sentCam;
    await teacher.getByTestId('switch-camera').click();
    await expect.poll(async () => (await info(teacher)).sentCam, { timeout: 15_000 }).not.toBe(beforeT);
  }
  for (const [p, base] of [[teacher, t0], [student, s0]] as const) { const i = await info(p); expect(i.pcCount).toBe(1); expect(i.liveCameraTracks).toBe(1); expect(i.liveAudioTracks).toBe(1); expect(i.renegotiations).toBe(base.renegotiations); /* only the initial negotiation ever happened */ expect(i.senders).toBe(2); expect(i.sentAudioId).toBe(base.sentAudioId); }
  expect(await remoteMoving(teacher)).toBe(true); expect(await remoteMoving(student)).toBe(true);
  await connected(teacher, student);
  expect(errs).toEqual([]);

  // 4) end: End Interview & Evaluate still works and every camera is released
  await teacher.getByTestId('end-interview').click(); await teacher.getByTestId('confirm-end').click();
  await expect(teacher.getByTestId('evaluation-form')).toBeVisible({ timeout: 20_000 });
  await expect(student.getByTestId('interview-room')).toHaveCount(0, { timeout: 20_000 });
  await expect.poll(async () => teacher.evaluate(() => (window as any).__tracks.filter((t: MediaStreamTrack) => t.readyState === 'live').length), { timeout: 10_000 }).toBe(0);
  await expect.poll(async () => student.evaluate(() => (window as any).__tracks.filter((t: MediaStreamTrack) => t.readyState === 'live').length), { timeout: 10_000 }).toBe(0);
  await tCtx.close(); await sCtx.close();
});

test('camera OFF is never turned on by Switch Camera; a device with ONE camera gets a disabled button and a clear hint - the call is unaffected', async ({ browser }) => {
  const errs: string[] = [];
  const req = await api('POST', '/request', fx.student2.token, { examId: fx.examId });
  const id2 = req.json.interview._id; expect((await api('POST', `/${id2}/accept`, fx.teacher2.token)).json.interview.status).toBe('APPROVED');
  const tCtx = await browser.newContext({ permissions: ['camera', 'microphone'] }); const sCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
  await instrument(tCtx); await instrument(sCtx);
  // the student's device reports a single camera
  await sCtx.addInitScript(() => { const md = navigator.mediaDevices; const od = md.enumerateDevices.bind(md); md.enumerateDevices = async () => (await od()).filter((d) => d.deviceId !== 'alias-cam'); });
  const teacher = await open(tCtx, fx.teacher2.token, `/teacher/interview/${id2}`, errs);
  const student = await open(sCtx, fx.student2.token, `/student/interview/${id2}`, errs);
  await connected(teacher, student);

  // one camera: disabled + explained, nothing else changes
  await expect(student.getByTestId('switch-camera')).toBeDisabled();
  await expect(student.getByTestId('switch-camera')).toHaveAttribute('title', /No other camera/);
  await expect(student.getByTestId('switch-camera-hint')).toContainText('Only one camera');
  expect(await remoteMoving(teacher)).toBe(true);

  // two cameras + camera turned OFF: the button is disabled and the camera stays off
  await expect(teacher.getByTestId('switch-camera')).toBeEnabled({ timeout: 15_000 });
  const before = (await info(teacher)).sentCam;
  await teacher.getByRole('button', { name: /Turn camera off/ }).click();
  await expect(teacher.getByTestId('switch-camera')).toBeDisabled();
  await expect(teacher.getByTestId('switch-camera')).toHaveAttribute('title', /Turn your camera on/);
  await teacher.getByTestId('switch-camera').click({ force: true }).catch(() => undefined);
  await teacher.waitForTimeout(800);
  expect((await info(teacher)).sentCam).toBe(before);
  await expect(teacher.getByTestId('camera-status')).toHaveText('Camera: turned off');
  await teacher.getByRole('button', { name: /Turn camera on/ }).click();
  await expect(teacher.getByTestId('switch-camera')).toBeEnabled();
  await teacher.getByTestId('switch-camera').click();
  await expect.poll(async () => (await info(teacher)).sentCam, { timeout: 15_000 }).not.toBe(before);
  expect(await remoteMoving(student)).toBe(true);
  expect(errs).toEqual([]);
  await tCtx.close(); await sCtx.close();
});

test('phone-sized screen (360x740, touch): Switch Camera sits with the other controls - no overflow, no overlap, 44px touch targets, End Interview still distinct', async ({ browser }) => {
  const errs: string[] = [];
  const req = await api('POST', '/request', fx.student3.token, { examId: fx.examId });
  const id3 = req.json.interview._id; expect((await api('POST', `/${id3}/accept`, fx.teacher2.token)).json.interview.status).toBe('APPROVED');
  const mk = () => browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const tCtx = await mk(); const sCtx = await mk(); await instrument(tCtx); await instrument(sCtx);
  const teacher = await open(tCtx, fx.teacher2.token, `/teacher/interview/${id3}`, errs);
  const student = await open(sCtx, fx.student3.token, `/student/interview/${id3}`, errs);
  await connected(teacher, student);
  await expect(teacher.getByTestId('switch-camera')).toBeEnabled({ timeout: 15_000 });
  for (const page of [teacher, student]) {
    const m = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="interview-room"]')!; const btns = [...root.parentElement!.querySelectorAll('button')].filter((b) => (b as HTMLElement).offsetParent) as HTMLElement[];
      const rects = btns.map((b) => { const r = b.getBoundingClientRect(); return { t: (b.textContent || '').trim(), x: r.x, y: r.y, w: r.width, h: r.height }; });
      const overlap = rects.some((a, i) => rects.some((b, j) => j > i && a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1));
      return { rects, overlap, scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth };
    });
    expect(m.overlap).toBe(false); expect(m.scrollW).toBeLessThanOrEqual(m.clientW);
    const sw = m.rects.find((r) => /Switch Camera/.test(r.t))!; expect(sw).toBeTruthy(); expect(sw.h).toBeGreaterThanOrEqual(44); expect(sw.x).toBeGreaterThanOrEqual(0); expect(sw.x + sw.w).toBeLessThanOrEqual(360);
  }
  await teacher.getByTestId('switch-camera').scrollIntoViewIfNeeded();
  await teacher.screenshot({ path: 'test-results/switch-camera-mobile-teacher.png', fullPage: true });
  await student.screenshot({ path: 'test-results/switch-camera-mobile-student.png', fullPage: true });
  // a tap works on touch devices
  const before = (await info(teacher)).sentCam; await teacher.getByTestId('switch-camera').tap();
  await expect.poll(async () => (await info(teacher)).sentCam, { timeout: 15_000 }).not.toBe(before);
  expect(errs).toEqual([]); await tCtx.close(); await sCtx.close();
});
