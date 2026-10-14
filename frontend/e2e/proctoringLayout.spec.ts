/**
 * TASK 1 - the proctoring camera panel never covers the exam, on the teacher exam AND the Olympiad exam pages.
 * TASK 2 - the pre-exam consent checkbox is clearly visible and usable on phones and tablets, and cannot be bypassed.
 *
 * "Not covered" is checked two ways at every viewport:
 *   1. bounding boxes: the panel's box does not intersect any question number, option, navigation / submit button,
 *      the question text or the palette (at the top of the page AND scrolled to the bottom);
 *   2. hit testing: the element under the centre of every one of those controls is the control itself
 *      (document.elementFromPoint) - so nothing is painted on top of it, whatever its z-index.
 * Camera: Chromium's fake device. Detector: the e2e-only scripted detector (see proctoringMock.ts).
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import { mockApi } from './mockApi';
import { findOverflow } from './layout';
import { EXAM_ID, MockProctorServer, setup, installDetector, passChecks } from './proctoringMock';

test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  permissions: ['camera'],
});

const VIEWPORTS = [
  { width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 360, height: 800 },
];

type Box = { x: number; y: number; width: number; height: number };
const intersects = (a: Box, b: Box) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

/**
 * Every on-screen element of `targets`: the part of it that is actually visible (clipped by its scroll containers, the
 * viewport and the sticky exam header) does not intersect the camera panel, and the element painted at its centre is
 * the element itself - so nothing covers it, whatever the z-index.
 */
async function expectNotCovered(page: Page, targets: Locator, what: string) {
  const handles = await targets.elementHandles();
  const results = await page.evaluate((els) => {
    type R = { l: number; t: number; r: number; b: number };
    const vw = document.documentElement.clientWidth; const vh = window.innerHeight;
    const header = document.querySelector('header');
    const headerBottom = header && getComputedStyle(header).position === 'sticky' ? header.getBoundingClientRect().bottom : 0;
    const clip = (el: Element): R | null => {
      const q = el.getBoundingClientRect();
      const top = header && header.contains(el) ? 0 : headerBottom; // content scrolled under the sticky header is not on screen
      let r: R = { l: Math.max(q.left, 0), t: Math.max(q.top, top), r: Math.min(q.right, vw), b: Math.min(q.bottom, vh) };
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
          const pr = p.getBoundingClientRect();
          r = { l: Math.max(r.l, pr.left), t: Math.max(r.t, pr.top), r: Math.min(r.r, pr.right), b: Math.min(r.b, pr.bottom) };
        }
      }
      return r.r - r.l > 1 && r.b - r.t > 1 ? r : null;
    };
    const panelEl = document.querySelector('[data-testid="proctoring-panel"]')!;
    const pc = clip(panelEl); // the part of the panel that is on screen (it may have scrolled under the header)
    const pr = pc ? { left: pc.l, top: pc.t, right: pc.r, bottom: pc.b } : { left: 0, top: 0, right: 0, bottom: 0 };
    return els.map((el, i) => {
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || (el as HTMLElement).offsetParent === null) return { i, skipped: true };
      const r = clip(el);
      if (!r) return { i, skipped: true };
      const overlap = r.l < pr.right - 0.5 && pr.left < r.r - 0.5 && r.t < pr.bottom - 0.5 && pr.top < r.b - 0.5;
      const hit = document.elementFromPoint((r.l + r.r) / 2, (r.t + r.b) / 2);
      const covered = !hit || !(el === hit || el.contains(hit));
      return { i, skipped: false, overlap, covered, by: covered && hit ? `${hit.tagName.toLowerCase()}${hit.getAttribute('data-testid') ? `[${hit.getAttribute('data-testid')}]` : ''}.${String(hit.className).slice(0, 60)}` : '', rect: r, panel: { l: pr.left, t: pr.top, r: pr.right, b: pr.bottom } };
    });
  }, handles);
  const shown = results.filter((x) => !x.skipped);
  for (const x of shown) {
    expect(x.overlap, `${what} #${x.i} overlaps the camera panel: ${JSON.stringify(x)}`).toBe(false);
    expect(x.covered, `${what} #${x.i} is covered by ${x.by}`).toBe(false);
  }
  return shown.length;
}

/** like expectNotCovered, and at least one of them must be on screen */
async function expectSomeNotCovered(page: Page, targets: Locator, what: string) {
  expect(await expectNotCovered(page, targets, what), `${what}: at least one on screen`).toBeGreaterThan(0);
}

async function expectInFlowPanel(page: Page) {
  const pos = await page.getByTestId('proctoring-panel').evaluate((el) => {
    const chain: string[] = [];
    for (let e: HTMLElement | null = el as HTMLElement; e && e !== document.body; e = e.parentElement) chain.push(getComputedStyle(e).position);
    return chain;
  });
  expect(pos.includes('fixed'), 'the panel (or a wrapper) must not be position: fixed').toBe(false);
  expect(pos[0]).not.toBe('absolute');
}

async function expectCameraShape(page: Page) {
  const cam = page.getByTestId('proctoring-camera');
  const b = await cam.boundingBox();
  expect(b).toBeTruthy();
  expect(Math.abs(b!.width / b!.height - 4 / 3)).toBeLessThan(0.05);
  expect(b!.width).toBeGreaterThanOrEqual(90);
  const v = cam.locator('video');
  await expect(v).toHaveCount(1);
  expect(await v.evaluate((el) => getComputedStyle(el).objectFit)).toBe('cover');
  const vb = await v.boundingBox();
  expect(vb!.width).toBeLessThanOrEqual(b!.width + 1); // the video stays inside its frame
  expect(vb!.height).toBeLessThanOrEqual(b!.height + 1);
}

async function expectNoOverflow(page: Page) {
  const r = await findOverflow(page);
  expect(r.offenders, JSON.stringify(r.offenders)).toEqual([]);
  expect(r.scrollWidth).toBeLessThanOrEqual(r.viewport + 1);
}

const scrollTo = (page: Page, where: 'top' | 'bottom') => page.evaluate((w) => window.scrollTo(0, w === 'top' ? 0 : document.documentElement.scrollHeight), where);

async function expectToggleWorks(page: Page, recheck: () => Promise<void>) {
  const toggle = page.getByTestId('proctoring-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('proctoring-camera')).toBeVisible();
  const openH = (await page.getByTestId('proctoring-panel').boundingBox())!.height;
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('proctoring-camera')).toBeHidden();
  await expect(page.getByTestId('proctoring-status')).toBeVisible(); // the status line stays visible when collapsed
  expect((await page.getByTestId('proctoring-panel').boundingBox())!.height).toBeLessThan(openH);
  await recheck();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('proctoring-camera')).toBeVisible();
  // the live preview is still playing after collapsing / expanding
  await expect.poll(() => page.locator('[data-testid="proctoring-camera"] video').evaluate((v: HTMLVideoElement) => !v.paused && v.readyState >= 2)).toBe(true);
  await recheck();
}

// ───────────────────────── teacher exam (ExamTakerPage) ─────────────────────────
for (const vp of VIEWPORTS) {
  test(`teacher exam ${vp.width}x${vp.height}: the camera panel never covers the exam; expand/collapse works`, async ({ page }) => {
    await page.setViewportSize(vp);
    const server = new MockProctorServer();
    await installDetector(page);
    await setup(page, server);
    await page.goto(`/student/exams/${EXAM_ID}`);
    await passChecks(page);
    await expect(page.getByTestId('proctoring-status')).toHaveText('Monitoring active', { timeout: 8000 });
    await expectInFlowPanel(page);
    await expectCameraShape(page);

    const desktop = vp.width >= 1024;
    const panel = await page.getByTestId('proctoring-panel').boundingBox();
    const nav = await page.getByTestId('question-navigator').boundingBox();
    const question = await page.getByTestId('question-text').boundingBox();
    if (desktop) {
      // right sidebar, BELOW the question navigator, same column
      expect(panel!.y).toBeGreaterThanOrEqual(nav!.y + nav!.height - 1);
      expect(Math.abs(panel!.x - nav!.x)).toBeLessThan(2);
      expect(panel!.x).toBeGreaterThan(question!.x + question!.width - 1);
    } else {
      // in the page flow, above the question
      expect(panel!.y + panel!.height).toBeLessThanOrEqual(question!.y + 1);
    }

    const check = async () => {
      for (const where of ['top', 'bottom'] as const) {
        await scrollTo(page, where);
        await expectNotCovered(page, page.locator('[data-testid="question-navigator"] button'), 'question number');
        await expectNotCovered(page, page.getByTestId('exam-option'), 'answer option');
        await expectNotCovered(page, page.getByRole('button', { name: /Previous|Next|Review & Submit/ }), 'navigation button');
        await expectNotCovered(page, page.getByRole('button', { name: /^Submit$/ }), 'submit button');
        await expectNotCovered(page, page.getByTestId('question-text'), 'question text');
      }
      // every control is reachable: scrolled into view it is on screen and uncovered
      for (const [loc, what] of [
        [page.locator('[data-testid="question-navigator"] button').last(), 'last question number'],
        [page.getByTestId('exam-option').last(), 'last option'],
        [page.getByRole('button', { name: /Next|Review & Submit/ }).first(), 'next button'],
        [page.getByRole('button', { name: /^Submit$/ }), 'submit button'],
      ] as const) { await loc.scrollIntoViewIfNeeded(); await expectSomeNotCovered(page, loc, what); }
      await scrollTo(page, 'top');
      await expectNoOverflow(page);
    };
    await check();
    await expectToggleWorks(page, check);

    // the controls are really usable (not just uncovered): answer, move to another question
    await page.getByTestId('exam-option').nth(1).click();
    await page.locator('[data-testid="question-navigator"] button').nth(2).click();
    await expect(page.getByText('Question 3 of 3').first()).toBeVisible();
  });
}

// ───────────────────────── Olympiad exam (OlympiadTakerPage) ─────────────────────────
async function setupProctoredOlympiad(page: Page, server: MockProctorServer) {
  await mockApi(page, 'student', (method, path) => {
    if (method === 'GET' && path === '/olympiad/exams/oly-ready') {
      return { body: { success: true, exam: { _id: 'oly-ready', title: 'LearnIQ – All India Olympiad Examination (Std 9)', standard: 9, durationMinutes: 60, totalQuestions: 60, totalMarks: 60, fee: 20, state: 'ready', paymentStatus: 'SUCCESS', attemptStatus: 'NOT_STARTED', startDate: new Date(Date.now() - 864e5).toISOString(), endDate: new Date(Date.now() + 864e5).toISOString(), instructions: [], proctoring: server.policy } } };
    }
    if (method === 'GET' && path === '/proctoring/olympiad/oly-ready/eligibility') return { body: { success: true, eligible: true, resume: false, proctoring: server.policy } };
    if (method === 'POST' && path === '/proctoring/olympiad/oly-ready/session') { server.sessionOpen = true; return { status: 201, body: { success: true, resumed: false, state: server.state() } }; }
    if (method === 'POST' && path === '/proctoring/sessions/sess-1/events') return { body: { success: true, accepted: 0, state: server.state() } };
    if (method === 'POST' && path === '/proctoring/sessions/sess-1/heartbeat') return { body: { success: true, state: server.state(), remainingSeconds: 3400 } };
    return undefined;
  });
}

for (const vp of VIEWPORTS) {
  test(`Olympiad exam ${vp.width}x${vp.height}: the camera panel sits below the palette (desktop) / in the flow (mobile) and covers nothing`, async ({ page }) => {
    await page.setViewportSize(vp);
    const server = new MockProctorServer();
    await installDetector(page);
    await setupProctoredOlympiad(page, server);
    await page.goto('/student/olympiad/oly-ready/take');
    await passChecks(page);
    await expect(page.getByText('Question 1 of 60').filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByTestId('proctoring-status')).toHaveText('Monitoring active', { timeout: 8000 });
    await expectInFlowPanel(page);
    await expectCameraShape(page);

    const desktop = vp.width >= 1024;
    const panel = await page.getByTestId('proctoring-panel').boundingBox();
    const question = await page.getByTestId('question-text').boundingBox();
    if (desktop) {
      const palette = await page.getByTestId('question-palette').boundingBox();
      expect(panel!.y).toBeGreaterThanOrEqual(palette!.y + palette!.height - 1); // BELOW the question numbers
      expect(Math.abs(panel!.x - palette!.x)).toBeLessThan(2);
      expect(panel!.y + panel!.height).toBeLessThanOrEqual(vp.height + 1); // fully visible in the sticky sidebar
    } else {
      await expect(page.getByTestId('question-palette')).toBeHidden(); // phones/tablets use the palette drawer
      expect(panel!.y + panel!.height).toBeLessThanOrEqual(question!.y + 1);
    }

    const controls = async () => {
      for (const where of ['top', 'bottom'] as const) {
        await scrollTo(page, where);
        if (desktop) await expectNotCovered(page, page.locator('[data-testid="question-palette"] button'), 'question number');
        await expectNotCovered(page, page.getByTestId('exam-option'), 'answer option');
        await expectNotCovered(page, page.getByRole('button', { name: /Clear Answer|Mark for Review|Unmark Review/ }), 'answer action');
        await expectNotCovered(page, page.getByRole('button', { name: /Previous|Next/ }), 'navigation button');
        await expectNotCovered(page, page.getByRole('button', { name: /Submit/ }), 'submit button');
        await expectNotCovered(page, page.getByTestId('question-text'), 'question text');
      }
      for (const [loc, what] of [
        [page.getByTestId('exam-option').last(), 'last option'],
        [page.getByRole('button', { name: /Clear Answer/ }), 'clear answer'],
        [page.getByRole('button', { name: /Mark for Review|Unmark Review/ }), 'mark for review'],
        [page.getByRole('button', { name: /^Previous$/ }), 'previous'],
        [page.getByRole('button', { name: /^Next$/ }), 'next'],
        [page.getByRole('button', { name: /Submit/ }).filter({ visible: true }).first(), 'submit'],
      ] as const) { await loc.scrollIntoViewIfNeeded(); await expectSomeNotCovered(page, loc, what); }
      await scrollTo(page, 'top');
      await expectNoOverflow(page);
    };
    await controls();
    await expectToggleWorks(page, controls);

    if (desktop) {
      // the long palette scrolls inside the sidebar; the last question number is reachable and still not covered
      const last = page.locator('[data-testid="question-palette"] button').last();
      await last.scrollIntoViewIfNeeded();
      await expectSomeNotCovered(page, last, 'last question number');
      const num = (await last.innerText()).trim().match(/\d+/)![0];
      await last.click();
      await expect(page.getByText(`Question ${num} of 60`).filter({ visible: true }).first()).toBeVisible();
    } else {
      // the palette drawer opens above everything, the panel included
      await page.getByRole('button', { name: 'Open question palette' }).click();
      const drawer = page.getByRole('dialog', { name: 'Question palette' });
      await expect(drawer).toBeVisible();
      const firstNumber = drawer.locator('button').nth(1);
      const b = (await firstNumber.boundingBox())!;
      expect(await firstNumber.evaluate((el, [x, y]) => { const h = document.elementFromPoint(x, y); return !!h && (el === h || el.contains(h)); }, [b.x + b.width / 2, b.y + b.height / 2] as const)).toBe(true);
      await firstNumber.click();
    }
  });
}

// ───────────────────────── TASK 2: consent checkbox ─────────────────────────
for (const width of [360, 390, 768]) {
  test(`consent ${width}px: a visible 20-24px checkbox, toggled by the box and by its text, never pre-ticked, cannot be bypassed`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 768 ? 800 : 1024 });
    const server = new MockProctorServer();
    await installDetector(page);
    await setup(page, server);
    await page.goto(`/student/exams/${EXAM_ID}`);
    await expect(page.getByTestId('proctoring-gate')).toBeVisible();
    await expect(page.getByTestId('check-eligibility')).toHaveAttribute('data-state', 'ok');

    const box = page.getByTestId('consent');
    const label = page.getByTestId('consent-label');
    const text = page.getByTestId('consent-text');
    await label.scrollIntoViewIfNeeded();
    await expect(box).toBeVisible();
    await expect(box).not.toBeChecked(); // never auto-checked
    await expect(page.getByRole('checkbox', { name: /I have read these rules and agree to camera monitoring/ })).toBeVisible(); // a real labelled checkbox

    const b = (await box.boundingBox())!;
    expect(b.width).toBeGreaterThanOrEqual(20); expect(b.width).toBeLessThanOrEqual(24);
    expect(Math.abs(b.width - b.height)).toBeLessThan(1); // not squeezed by the long text
    const l = (await label.boundingBox())!;
    expect(l.height).toBeGreaterThanOrEqual(44); // the whole row is the touch target
    expect(b.x).toBeGreaterThanOrEqual(l.x); expect(b.x + b.width).toBeLessThanOrEqual(l.x + l.width);
    // aligned with the FIRST line of the text, and the text wraps instead of overflowing
    const firstLine = await text.evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); const rects = Array.from(r.getClientRects()); return { top: rects[0].top, bottom: rects[0].bottom, lines: new Set(rects.map((x) => Math.round(x.top))).size }; });
    expect(Math.abs((b.y + b.height / 2) - (firstLine.top + firstLine.bottom) / 2)).toBeLessThanOrEqual(4);
    if (width < 768) expect(firstLine.lines).toBeGreaterThan(1);
    await expectNoOverflow(page);

    // visible: a real border with enough contrast against the row, in light AND dark mode
    const contrast = () => box.evaluate((el) => {
      const rgb = (c: string) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const lum = ([r, g, bl]: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl); };
      let bg = 'rgb(255,255,255)';
      for (let p = el.parentElement; p; p = p.parentElement) { const c = getComputedStyle(p).backgroundColor; if (c && !/rgba\(.*,\s*0\)|transparent/.test(c)) { bg = c; break; } }
      const s = getComputedStyle(el);
      const [a, z] = [lum(rgb(s.borderTopColor)), lum(rgb(bg))];
      return { ratio: (Math.max(a, z) + 0.05) / (Math.min(a, z) + 0.05), border: parseFloat(s.borderTopWidth) };
    });
    const light = await contrast();
    expect(light.border).toBeGreaterThanOrEqual(2);
    expect(light.ratio, 'light theme border contrast').toBeGreaterThanOrEqual(3);
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.waitForTimeout(400); // let the label's colour transition finish
    const dark = await contrast();
    expect(dark.ratio, 'dark theme border contrast').toBeGreaterThanOrEqual(3);
    await page.evaluate(() => document.documentElement.classList.remove('dark'));

    // cannot continue without it
    await expect(page.getByTestId('camera-button')).toBeDisabled();
    await expect(page.getByTestId('start-secure-exam')).toBeDisabled();
    // ...even if the disabled attribute is removed by hand, nothing is started
    await page.getByTestId('start-secure-exam').evaluate((el) => { el.removeAttribute('disabled'); (el as HTMLButtonElement).click(); });
    await page.waitForTimeout(300);
    expect(server.sessionRequests).toHaveLength(0);
    expect(server.startCalls).toBe(0);

    // toggles via the box itself
    await box.click();
    await expect(box).toBeChecked();
    await expect(page.getByTestId('camera-button')).toBeEnabled();
    await box.click();
    await expect(box).not.toBeChecked();
    // ...and via the text (the whole label)
    await text.click();
    await expect(box).toBeChecked();
    await text.click();
    await expect(box).not.toBeChecked();
    await expect(page.getByTestId('camera-button')).toBeDisabled();
    // keyboard
    await box.focus();
    await page.keyboard.press('Space');
    await expect(box).toBeChecked();

    // with consent the normal checks can run and the exam starts, sending consent to the server
    await page.getByTestId('camera-button').click();
    await expect(page.getByTestId('face-message')).toHaveText('Camera verification successful.', { timeout: 15000 });
    await page.getByTestId('start-secure-exam').click();
    await expect(page.getByTestId('proctoring-panel')).toBeVisible({ timeout: 15000 });
    expect(server.sessionRequests[0]).toMatchObject({ consent: true });
  });
}
