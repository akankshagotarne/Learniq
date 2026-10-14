import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

/**
 * Two real browsers, real WebRTC (fake capture devices), real signalling server. Proves: the student cannot enter before the
 * teacher approves; after approval both sides get the OTHER side's live video; two interviews can run at the same time in
 * separate rooms; ending the interview closes the call for the student. It does NOT prove quality over real networks
 * (no TURN, no packet loss) or behaviour on physical webcams / Safari / mobile browsers.
 */
type Fixture = { base: string; examId: string; teacher: { token: string }; teacher2: { token: string }; student: { token: string }; student2: { token: string }; student3: { token: string } };
let harness: ChildProcess; let fx: Fixture;

test.beforeAll(async () => {
  const cwd = path.resolve(process.cwd(), '..', 'backend');
  harness = spawn('node', ['src/tests/helpers/interviewHarness.js', '5055'], { cwd, stdio: ['ignore', 'pipe', 'inherit'] });
  fx = await new Promise<Fixture>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('harness did not start')), 20000);
    harness.stdout!.on('data', (d: Buffer) => {
      const line = d.toString().split('\n').find((l) => l.startsWith('READY '));
      if (line) { clearTimeout(t); resolve(JSON.parse(line.slice(6))); }
    });
    harness.on('exit', () => reject(new Error('harness exited')));
  });
});
test.afterAll(() => { harness?.kill(); });

const call = async (method: string, url: string, token: string, body?: unknown) => {
  const res = await fetch(`${fx.base}/api/interviews${url}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
};

const openAs = async (ctx: BrowserContext, token: string, url: string): Promise<Page> => {
  await ctx.addInitScript((t) => localStorage.setItem('learniq_token', t), token);
  const page = await ctx.newPage();
  await page.goto(url);
  return page;
};

/** remote <video> is playing real frames */
const hasRemoteVideo = (page: Page) => expect.poll(async () => page.evaluate(() => {
  const v = document.querySelector('[data-testid="remote-video"]') as HTMLVideoElement | null;
  return !!v && v.videoWidth > 0 && v.readyState >= 2 && !v.paused;
}), { timeout: 30_000 }).toBe(true);

const startInterview = async (studentToken: string, teacherToken: string) => {
  const req = await call('POST', '/request', studentToken, { examId: fx.examId });
  expect(req.status).toBeLessThan(300);
  const id = req.json.interview._id as string;
  const st = await call('POST', '/teacher/start', teacherToken, { interviewId: id });
  expect(st.json.interview.status).toBe('ASSIGNED');
  const jr = await call('POST', `/${id}/join-request`, studentToken);
  expect(jr.json.interview.status).toBe('WAITING_FOR_APPROVAL');
  return id;
};

test('two-way video after teacher approval; the student cannot enter before; ending closes the call', async ({ browser }) => {
  const id = await startInterview(fx.student.token, fx.teacher.token);
  const sCtx = await browser.newContext(); const tCtx = await browser.newContext();

  // before approval the student has no room at all, and the room endpoints refuse
  const early = await call('POST', `/${id}/room-access`, fx.student.token);
  expect(early.status).toBeGreaterThanOrEqual(400);
  const student = await openAs(sCtx, fx.student.token, `/student/interview/${id}`);
  await expect(student.getByTestId('interview-status')).toHaveText('Waiting for Teacher Approval');
  await expect(student.getByTestId('interview-room')).toHaveCount(0);

  const teacher = await openAs(tCtx, fx.teacher.token, `/teacher/interview/${id}`);
  await teacher.getByTestId('approve').click();

  await expect(student.getByTestId('interview-room')).toBeVisible({ timeout: 20_000 });
  await expect(teacher.getByTestId('interview-room')).toBeVisible();
  await hasRemoteVideo(teacher);
  await hasRemoteVideo(student);
  await expect(teacher.getByTestId('interview-room')).toHaveAttribute('data-phase', 'connected', { timeout: 30_000 });
  await expect(student.getByTestId('interview-room')).toHaveAttribute('data-phase', 'connected', { timeout: 30_000 });
  await expect(teacher.getByTestId('interview-status')).toHaveText('In progress', { timeout: 20_000 });

  // a third person (the other teacher) is refused by the server
  const intruder = await call('POST', `/${id}/room-access`, fx.teacher2.token);
  expect(intruder.status).toBeGreaterThanOrEqual(400);

  // mic toggle is reflected for the other side
  await teacher.getByRole('button', { name: /Mute microphone/ }).click();
  await expect(student.getByText('Muted')).toBeVisible();

  // teacher ends -> student sees Completed and the room is gone
  await teacher.getByTestId('end-interview').click();
  await teacher.getByTestId('confirm-complete').click();
  await expect(student.getByTestId('interview-status')).toHaveText('Completed', { timeout: 20_000 });
  await expect(student.getByTestId('interview-room')).toHaveCount(0);
  await sCtx.close(); await tCtx.close();
});

test('two different teachers interview two different students at the same time, in separate rooms', async ({ browser }) => {
  const idA = await startInterview(fx.student2.token, fx.teacher.token);
  const idB = await startInterview(fx.student3.token, fx.teacher2.token);
  expect(idA).not.toBe(idB);
  const ctxs = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext(), browser.newContext()]);
  const [sA, tA, sB, tB] = await Promise.all([
    openAs(ctxs[0], fx.student2.token, `/student/interview/${idA}`), openAs(ctxs[1], fx.teacher.token, `/teacher/interview/${idA}`),
    openAs(ctxs[2], fx.student3.token, `/student/interview/${idB}`), openAs(ctxs[3], fx.teacher2.token, `/teacher/interview/${idB}`),
  ]);
  await tA.getByTestId('approve').click();
  await tB.getByTestId('approve').click();
  for (const p of [sA, tA, sB, tB]) await hasRemoteVideo(p);

  // teacher 1 cannot reach teacher 2's room and vice versa
  expect((await call('POST', `/${idB}/room-access`, fx.teacher.token)).status).toBeGreaterThanOrEqual(400);
  expect((await call('POST', `/${idA}/room-access`, fx.teacher2.token)).status).toBeGreaterThanOrEqual(400);

  // ending A leaves B untouched
  await tA.getByTestId('end-interview').click();
  await tA.getByTestId('confirm-complete').click();
  await expect(sA.getByTestId('interview-status')).toHaveText('Completed', { timeout: 20_000 });
  await expect(tB.getByTestId('interview-room')).toHaveAttribute('data-phase', 'connected');
  await hasRemoteVideo(sB);
  await Promise.all(ctxs.map((c) => c.close()));
});
