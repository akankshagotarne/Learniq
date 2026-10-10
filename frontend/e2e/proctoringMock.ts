/**
 * Shared by the proctoring browser tests: a mock server that applies the same counting / threshold rules as
 * backend/src/services/proctoring, the exam fixtures, and helpers to pass the pre-exam checks.
 */
import { expect, type Page, type Route } from '@playwright/test';
import { mockApi } from './mockApi';

export const EXAM_ID = 'ex-p1';
const QUESTIONS = [0, 1, 2].map((i) => ({ _id: `q${i}`, type: 'mcq', question: `What is ${i} + ${i}?`, options: [`${2 * i}`, `${2 * i + 1}`, 'none', 'all'], marks: 1, order: i }));

export const POLICY = {
  enabled: true, version: 1, cameraRequired: true, faceMonitoring: true, multiFaceMonitoring: true, phoneDetection: true,
  fullscreenRequired: true, strictMode: false, desktopRequired: false, switchAction: 'WARN_AND_REQUIRE_FULLSCREEN',
  cameraFailureAction: 'BLOCK_UNTIL_RESTORED', maxFaceAbsenceWarnings: 5, maxMultiFaceWarnings: 3, maxPhoneWarnings: 2,
  // shorter than the production defaults so the tests run quickly - the logic is identical
  faceAbsenceThresholdMs: 2000, multiFacePersistenceMs: 1200, phonePersistenceMs: 900, phoneConfidence: 0.5,
  recoveryMs: 800, fullscreenGraceMs: 3000, cameraGraceMs: 10000, warningCooldownMs: 1000,
};

type Counts = Record<'faceAbsence' | 'multiFace' | 'phone' | 'fullscreenExit' | 'tabSwitch' | 'windowBlur' | 'camera' | 'network' | 'copyPaste', number>;
const COUNTER: Record<string, keyof Counts | null> = {
  FACE_MISSING: 'faceAbsence', MULTIPLE_FACES: 'multiFace', MOBILE_PHONE_DETECTED: 'phone', FULLSCREEN_EXIT: 'fullscreenExit',
  TAB_SWITCH: 'tabSwitch', WINDOW_BLUR: 'windowBlur', COPY_PASTE: 'copyPaste', CAMERA_DISCONNECTED: 'camera',
  CAMERA_UNAVAILABLE: 'camera', VIDEO_FEED_STALLED: 'camera', FULLSCREEN_NOT_RESTORED: null, CAMERA_NOT_RESTORED: null, CAMERA_RESTORED: null,
};
const TEXT: Record<string, string> = {
  FACE_ABSENCE_LIMIT: 'Maximum face-absence warnings reached.', MULTIPLE_FACES_LIMIT: 'Multiple faces repeatedly detected.',
  MOBILE_PHONE_REPEATED: 'Mobile phone repeatedly detected.', STRICT_POLICY_VIOLATION: 'Strict examination policy violation.',
  CAMERA_FAILURE: 'The camera could not be restored.',
};

/** Mirrors the backend rules (counting, thresholds, termination) so the UI can be tested end to end. */
export class MockProctorServer {
  policy: typeof POLICY;
  counts: Counts = { faceAbsence: 0, multiFace: 0, phone: 0, fullscreenExit: 0, tabSwitch: 0, windowBlur: 0, camera: 0, network: 0, copyPaste: 0 };
  events: { type: string; confidence?: number; metadata?: Record<string, unknown> }[] = [];
  seen = new Set<string>();
  snapshots: unknown[] = [];
  bodies: string[] = [];
  started = false; sessionOpen = false; terminated: string | null = null; submitted = false;
  sessionRequests: unknown[] = [];
  startCalls = 0;
  drafts: Record<string, number | null> = {};
  constructor(over: Partial<typeof POLICY> = {}) { this.policy = { ...POLICY, ...over }; }
  state() {
    return {
      sessionId: 'sess-1', status: this.terminated ? 'COMPLETED' : 'ACTIVE', proctoringStatus: this.terminated ? 'AUTO_SUBMITTED' : 'NOT_FLAGGED',
      counts: { ...this.counts }, limits: { faceAbsence: this.policy.maxFaceAbsenceWarnings, multiFace: this.policy.maxMultiFaceWarnings, phone: this.policy.maxPhoneWarnings },
      policy: this.policy, terminated: !!this.terminated, terminationReason: this.terminated, terminationText: this.terminated ? TEXT[this.terminated] : null,
      autoSubmitted: !!this.terminated,
    };
  }
  record(evs: { clientEventId: string; type: string; confidence?: number; metadata?: Record<string, unknown> }[], snapshot?: unknown) {
    if (snapshot !== undefined) this.snapshots.push(snapshot);
    for (const e of evs) {
      if (this.terminated || this.seen.has(e.clientEventId)) continue;
      this.seen.add(e.clientEventId);
      this.events.push({ type: e.type, confidence: e.confidence, metadata: e.metadata });
      const c = COUNTER[e.type];
      if (e.type === 'MOBILE_PHONE_DETECTED' && !((e.confidence ?? 0) >= this.policy.phoneConfidence)) continue;
      if (c) this.counts[c] += 1;
      const p = this.policy;
      if (e.type === 'FACE_MISSING' && this.counts.faceAbsence >= p.maxFaceAbsenceWarnings) this.terminated = 'FACE_ABSENCE_LIMIT';
      if (e.type === 'MULTIPLE_FACES' && this.counts.multiFace >= p.maxMultiFaceWarnings) this.terminated = 'MULTIPLE_FACES_LIMIT';
      if (e.type === 'MOBILE_PHONE_DETECTED' && this.counts.phone > p.maxPhoneWarnings) this.terminated = 'MOBILE_PHONE_REPEATED';
      if ((e.type === 'TAB_SWITCH' || e.type === 'FULLSCREEN_NOT_RESTORED') && p.switchAction === 'AUTO_SUBMIT_ON_CONFIRMED_SWITCH') this.terminated = 'STRICT_POLICY_VIOLATION';
    }
    if (this.terminated) this.submitted = true;
  }
  count(type: string) { return this.events.filter((e) => e.type === type).length; }
}

export const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

export async function setup(page: Page, server: MockProctorServer) {
  await mockApi(page, 'student');
  await page.route('**/api/{exams,proctoring}/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^.*?\/api/, '');
    const body = req.postData() || '';
    if (body) server.bodies.push(body);
    const m = req.method();
    if (m === 'GET' && path === `/exams/${EXAM_ID}`) {
      return json(route, 200, {
        success: true,
        exam: { _id: EXAM_ID, title: 'Algebra Unit Test (proctored)', standard: 10, subject: 'Mathematics', durationMinutes: 30, totalMarks: 3, negativeMarking: false, negativeMarkValue: 0.25, passingMarks: 1, attemptLimit: 1, isPublished: true, isActive: true, teacher: { _id: 't1', name: 'Nikhil' }, questions: QUESTIONS, proctoring: server.policy, createdAt: new Date().toISOString() },
        inProgressAttempt: server.started && !server.submitted ? { _id: 'att-1', status: 'in-progress', startedAt: new Date().toISOString(), remainingSeconds: 1700, draftAnswers: server.drafts } : null,
      });
    }
    if (m === 'POST' && path === `/exams/${EXAM_ID}/start`) {
      server.startCalls += 1;
      const resumed = server.started; server.started = true;
      return json(route, resumed ? 200 : 201, { success: true, resumed, attempt: { _id: 'att-1', status: 'in-progress', remainingSeconds: 1800, draftAnswers: server.drafts } });
    }
    if (m === 'PUT' && path === `/exams/${EXAM_ID}/draft`) {
      if (server.submitted) return json(route, 409, { success: false, code: 'ALREADY_COMPLETED', message: 'Already submitted.' });
      server.drafts = JSON.parse(body).draftAnswers; return json(route, 200, { success: true, remainingSeconds: 1700 });
    }
    if (m === 'POST' && path === `/exams/${EXAM_ID}/submit`) {
      server.submitted = true;
      return json(route, 200, { success: true, result: { score: 1, totalMarks: 3, percentage: 33.3, timeTaken: 75, rank: 1, totalAttemptees: 1, percentile: 100, passed: true, status: server.terminated ? 'auto-submitted' : 'submitted' }, review: [] });
    }
    if (m === 'GET' && path === `/proctoring/exam/${EXAM_ID}/eligibility`) {
      return json(route, 200, server.submitted ? { success: true, eligible: false, code: 'ALREADY_COMPLETED', message: 'Already submitted.', proctoring: server.policy } : { success: true, eligible: true, resume: server.started, proctoring: server.policy });
    }
    if (m === 'POST' && path === `/proctoring/exam/${EXAM_ID}/session`) {
      const b = JSON.parse(body); server.sessionRequests.push(b);
      if (b.precheck?.faceCount !== 1 || b.precheck?.fullscreen !== true || b.consent !== true) return json(route, 400, { success: false, code: 'PRECHECK_REQUIRED', message: 'Checks not passed.' });
      const resumed = server.sessionOpen; server.sessionOpen = true;
      return json(route, resumed ? 200 : 201, { success: true, resumed, state: server.state() });
    }
    if (m === 'POST' && path === '/proctoring/sessions/sess-1/events') {
      const b = JSON.parse(body); server.record(b.events, b.answersSnapshot);
      return json(route, 200, { success: true, accepted: b.events.length, state: server.state() });
    }
    if (m === 'POST' && path === '/proctoring/sessions/sess-1/heartbeat') return json(route, 200, { success: true, state: server.state(), remainingSeconds: 1700 });
    return route.fallback();
  });
}

/** Scripted detector: tests set window.__proctorScript.faceCount / phoneScore at any time. */
export async function installDetector(page: Page, faceCount = 1, phoneScore = 0) {
  await page.addInitScript(([f, p]) => {
    const w = window as any;
    w.__proctorScript = { faceCount: f, phoneScore: p };
    w.__proctorClosed = 0;
    w.__proctorTestDetector = {
      name: 'scripted-test-detector',
      async detect(_v: HTMLVideoElement, withPhone: boolean) { const s = w.__proctorScript; return { faceCount: s.faceCount, phoneScore: withPhone ? s.phoneScore : null, inferenceMs: 1 }; },
      close() { w.__proctorClosed += 1; },
    };
  }, [faceCount, phoneScore] as const);
}
export const setScene = (page: Page, faceCount: number, phoneScore = 0) => page.evaluate(([f, p]) => { (window as any).__proctorScript = { faceCount: f, phoneScore: p }; }, [faceCount, phoneScore] as const);

export async function passChecks(page: Page) {
  await expect(page.getByTestId('proctoring-gate')).toBeVisible();
  await expect(page.getByTestId('check-eligibility')).toHaveAttribute('data-state', 'ok');
  await page.getByTestId('consent').check();
  await page.getByTestId('camera-button').click();
  await expect(page.getByTestId('face-message')).toHaveText('Camera verification successful.', { timeout: 15000 });
  await page.getByTestId('start-secure-exam').click();
  await expect(page.getByTestId('proctoring-panel')).toBeVisible({ timeout: 15000 });
}

export async function startExam(page: Page, server: MockProctorServer) {
  await installDetector(page);
  await setup(page, server);
  await page.goto(`/student/exams/${EXAM_ID}`);
  await passChecks(page);
}

export const dismiss = (page: Page) => page.getByRole('button', { name: 'I understand' }).click();

