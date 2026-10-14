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

/** student requests; returns the interview id (the teacher accepts it in the UI or via accept()) */
const requestInterview = async (studentToken: string) => {
  const req = await call('POST', '/request', studentToken, { examId: fx.examId });
  expect(req.status).toBeLessThan(300);
  return req.json.interview._id as string;
};
const accept = async (teacherToken: string, id: string) => {
  const r = await call('POST', `/${id}/accept`, teacherToken);
  expect(r.json.interview.status).toBe('APPROVED');
};
const SCORES = { communication: 8, confidence: 9, subjectKnowledge: 7, listening: 8, logicalThinking: 8 }; // 40/50

test('request → teacher Accepts in the UI → both in the room with live video → End & Evaluate → submitted marks reach the student', async ({ browser }) => {
  const id = await requestInterview(fx.student.token);
  const sCtx = await browser.newContext(); const tCtx = await browser.newContext();

  // before any teacher accepts: no room access at all, the student just waits
  expect((await call('POST', `/${id}/room-access`, fx.student.token)).status).toBeGreaterThanOrEqual(400);
  const student = await openAs(sCtx, fx.student.token, `/student/interview/${id}`);
  await expect(student.getByTestId('interview-status')).toHaveText('Waiting for Teacher Approval');
  await expect(student.getByTestId('interview-room')).toHaveCount(0);

  // the teacher sees the request in the shared directory and accepts it
  const teacher = await openAs(tCtx, fx.teacher.token, '/teacher/interview');
  const row = teacher.locator('[data-testid="interview-row"]:visible').filter({ hasText: 'Student One' });
  await row.getByTestId('interview-accept').click();
  await expect(teacher).toHaveURL(new RegExp(`/teacher/interview/${id}$`));

  // the waiting student moves into the room by itself (no refresh)
  await expect(student.getByTestId('interview-room')).toBeVisible({ timeout: 20_000 });
  await expect(teacher.getByTestId('interview-room')).toBeVisible();
  await hasRemoteVideo(teacher);
  await hasRemoteVideo(student);
  await expect(teacher.getByTestId('interview-room')).toHaveAttribute('data-phase', 'connected', { timeout: 30_000 });
  await expect(student.getByTestId('interview-room')).toHaveAttribute('data-phase', 'connected', { timeout: 30_000 });
  await expect(teacher.getByTestId('interview-status')).toHaveText('In progress', { timeout: 20_000 });

  // a third person is refused; a second teacher cannot accept it
  expect((await call('POST', `/${id}/room-access`, fx.teacher2.token)).status).toBeGreaterThanOrEqual(400);
  expect((await call('POST', `/${id}/accept`, fx.teacher2.token)).status).toBe(409);

  await teacher.getByRole('button', { name: /Mute microphone/ }).click();
  await expect(student.getByText('Muted')).toBeVisible();

  // End Interview & Evaluate: the call closes, but the interview is NOT completed yet
  await teacher.getByTestId('end-interview').click();
  await teacher.getByTestId('confirm-end').click();
  await expect(teacher.getByTestId('evaluation-form')).toBeVisible({ timeout: 20_000 });
  await expect(student.getByTestId('interview-status')).toHaveText('Evaluation Pending', { timeout: 20_000 });
  await expect(student.getByTestId('interview-room')).toHaveCount(0);
  const pend = await call('GET', '/results', fx.student.token);
  expect(pend.json.results.length).toBe(0); expect(pend.json.pending.length).toBe(1);

  // teacher scores in the UI; the total updates live; submit with confirmation
  const keys = ['communication', 'confidence', 'subjectKnowledge', 'listening', 'logicalThinking'] as const;
  for (const k of keys) await teacher.getByTestId(`score-${k}-${SCORES[k]}`).click();
  await expect(teacher.getByTestId('eval-total')).toHaveText('40 / 50');
  await teacher.getByLabel(/Teacher's Remarks/).fill('Clear and confident.');
  await teacher.getByTestId('submit-eval').click();
  await teacher.getByTestId('confirm-submit').click();
  await expect(teacher.getByTestId('interview-status')).toHaveText('Completed', { timeout: 20_000 });
  await expect(student.getByTestId('interview-status')).toHaveText('Interview Completed', { timeout: 20_000 });

  // the student's Interview Results page shows the saved marks
  await student.goto('/student/interview-results');
  await expect(student.getByTestId('result-total')).toContainText('40/50');
  await expect(student.getByText('Clear and confident.')).toBeVisible();
  await sCtx.close(); await tCtx.close();
});

test('two different teachers interview two different students at the same time, in separate rooms', async ({ browser }) => {
  const idA = await requestInterview(fx.student2.token); await accept(fx.teacher.token, idA);
  const idB = await requestInterview(fx.student3.token); await accept(fx.teacher2.token, idB);
  expect(idA).not.toBe(idB);
  const ctxs = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext(), browser.newContext()]);
  const [sA, tA, sB, tB] = await Promise.all([
    openAs(ctxs[0], fx.student2.token, `/student/interview/${idA}`), openAs(ctxs[1], fx.teacher.token, `/teacher/interview/${idA}`),
    openAs(ctxs[2], fx.student3.token, `/student/interview/${idB}`), openAs(ctxs[3], fx.teacher2.token, `/teacher/interview/${idB}`),
  ]);
  for (const p of [sA, tA, sB, tB]) await hasRemoteVideo(p);

  expect((await call('POST', `/${idB}/room-access`, fx.teacher.token)).status).toBeGreaterThanOrEqual(400);
  expect((await call('POST', `/${idA}/room-access`, fx.teacher2.token)).status).toBeGreaterThanOrEqual(400);

  // ending A leaves B untouched
  await tA.getByTestId('end-interview').click();
  await tA.getByTestId('confirm-end').click();
  await expect(sA.getByTestId('interview-status')).toHaveText('Evaluation Pending', { timeout: 20_000 });
  await expect(tB.getByTestId('interview-room')).toHaveAttribute('data-phase', 'connected');
  await expect(sB.getByTestId('interview-room')).toHaveAttribute('data-phase', 'connected');
  await hasRemoteVideo(sB);
  await Promise.all(ctxs.map((c) => c.close()));
});
