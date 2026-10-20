/**
 * Live class chat layout: opening Class Chat must never cover the teacher video or the meeting controls.
 * Phones / tablets held upright: header, teacher video (top), chat (remaining space, own scroll), composer, control bar - stacked, no overlap.
 * Landscape / desktop: chat is a column beside the video. Uses the real RoomFrame / RoomBody / ChatPanel / ControlBar / MainStage with
 * generated video (/__e2e/live-stage, present in the e2e build only).
 */
import { test, expect, type Page } from '@playwright/test';

type R = { x: number; y: number; width: number; height: number };
const rect = async (page: Page, sel: string): Promise<R> => { const b = await page.locator(sel).first().boundingBox(); expect(b, sel).not.toBeNull(); return b!; };
const open = async (page: Page, qs: string) => {
  await page.goto(`/__e2e/live-stage?${qs}`);
  await expect(page.getByTestId('main-stage')).toBeVisible();
  await expect.poll(() => page.locator('[data-testid="main-stage"] video').first().evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);
};
const noHorizontalOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
const noPageScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(1);
const topAt = (page: Page, sel: string) => page.evaluate((s) => { const r = document.querySelector(s)!.getBoundingClientRect(); const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return el ? (el.closest('[data-testid]')?.getAttribute('data-testid') || el.tagName) : null; }, sel);

/** stacked: stage on top, chat underneath, controls at the bottom - each in its own band */
const expectStacked = async (page: Page, vpH: number, minStageH = 100) => {
  const stage = await rect(page, '[data-testid="stage-box"]');
  const chat = await rect(page, '[data-testid="chat-panel"]');
  const controls = await rect(page, '[data-testid="controls"]');
  const composer = await rect(page, '[data-testid="chat-composer"]');
  const header = await rect(page, '[data-testid="chat-panel"] h2');
  expect(stage.height).toBeGreaterThanOrEqual(minStageH);                              // teacher video stays usable, not a sliver
  expect(stage.y + stage.height).toBeLessThanOrEqual(chat.y + 1);                      // chat starts below the video
  expect(chat.y + chat.height).toBeLessThanOrEqual(controls.y + 1);                    // chat ends above the controls
  expect(composer.y + composer.height).toBeLessThanOrEqual(controls.y + 1);            // composer above the controls
  expect(controls.y + controls.height).toBeLessThanOrEqual(vpH + 1);
  expect(header.y).toBeGreaterThanOrEqual(chat.y - 1);
  await expect(page.locator('[data-testid="chat-panel"]')).toHaveCSS('position', 'relative');   // in the page flow, not a fixed overlay
  expect(await topAt(page, '[data-testid="stage-box"]')).not.toBe('chat-panel');
  await noHorizontalOverflow(page); await noPageScroll(page);
  return { stage, chat, controls, composer };
};

for (const vp of [
  { name: 'phone 390x844', width: 390, height: 844 },
  { name: 'small phone 360x640', width: 360, height: 640 },
  { name: 'tablet portrait 768x1024', width: 768, height: 1024 },
]) {
  test.describe(`portrait ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, isMobile: true, hasTouch: true });

    test('A/B: chat opens UNDER the teacher video with a clear empty state; video, chat, controls do not overlap', async ({ page }) => {
      await open(page, 'mode=camera&chat=open&msgs=0');
      const { stage } = await expectStacked(page, vp.height, vp.height <= 640 ? 100 : 150);
      await expect(page.getByTestId('chat-empty')).toContainText('No messages yet. Start the conversation.');
      const video = page.locator('[data-testid="main-stage"] video').first();
      expect(await video.evaluate((v: HTMLVideoElement) => getComputedStyle(v).objectFit)).toBe('contain');   // no crop / no stretch
      expect(Math.abs(stage.width / stage.height - 16 / 9)).toBeLessThan(0.1);                                  // aspect ratio preserved
      await expect(page.getByTestId('thumbnails')).toBeHidden();                                                // strip is folded away while chat uses the space
      expect((await rect(page, '[data-testid="chat-panel"] button[aria-label="Close chat"]')).height).toBeGreaterThanOrEqual(43);
      expect((await rect(page, 'button[aria-label="Send message"]')).width).toBeGreaterThanOrEqual(43);
    });

    test('C/D: many messages scroll inside the chat only; sending keeps the layout still and the video playing', async ({ page }) => {
      await open(page, 'mode=camera&chat=open&msgs=40');
      const before = await expectStacked(page, vp.height, vp.height <= 640 ? 100 : 150);
      const list = page.getByTestId('chat-messages');
      const sizes = await list.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, top: el.scrollTop }));
      expect(sizes.sh).toBeGreaterThan(sizes.ch);                                       // list scrolls on its own
      expect(sizes.top + sizes.ch).toBeGreaterThanOrEqual(sizes.sh - 2);                // newest message in view
      await list.evaluate((el) => { el.scrollTop = 0; });
      expect(await page.evaluate(() => window.scrollY)).toBe(0);                        // the page itself never moved
      const input = page.getByRole('textbox', { name: 'Message' });
      await input.fill('Hello sir, can you repeat that?');
      await page.getByRole('button', { name: 'Send message' }).click();
      await expect(list).toContainText('Hello sir, can you repeat that?');
      await expect(input).toHaveValue('');                                              // cleared only after the send succeeded
      const after = await expectStacked(page, vp.height, vp.height <= 640 ? 100 : 150);
      expect(Math.abs(after.stage.y - before.stage.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(after.stage.height - before.stage.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(after.controls.y - before.controls.y)).toBeLessThanOrEqual(1);
      expect(await page.locator('[data-testid="main-stage"] video').first().evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);
    });

    test('F: closing chat restores the normal layout, keeps history and the unsent draft, and does not remount the teacher video', async ({ page }) => {
      await open(page, 'mode=camera&msgs=5');
      await expect(page.getByTestId('chat-panel')).toHaveCount(0);
      const normal = await rect(page, '[data-testid="stage-box"]');
      const video = page.locator('[data-testid="main-stage"] video').first();
      await video.evaluate((v) => { (v as any).__same = 'marker'; });
      await page.getByTestId('btn-chat').click();
      await expect(page.getByTestId('chat-panel')).toBeVisible();
      await page.getByRole('textbox', { name: 'Message' }).fill('half written');
      await page.getByRole('button', { name: 'Close chat' }).first().click();
      await expect(page.getByTestId('chat-panel')).toHaveCount(0);
      const restored = await rect(page, '[data-testid="stage-box"]');
      expect(Math.abs(restored.height - normal.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(restored.width - normal.width)).toBeLessThanOrEqual(1);
      await expect(page.getByTestId('thumbnails')).toBeVisible();
      await page.getByTestId('btn-chat').click();
      await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('half written');             // draft survives close / open
      await expect(page.getByTestId('chat-messages')).toContainText('Message number 5');  // history retained
      expect(await video.evaluate((v: HTMLVideoElement) => (v as any).__same === 'marker' && v.videoWidth > 0)).toBe(true);   // same element, still playing
    });

    test('G: while the teacher shares a screen the shared screen stays on top, the camera PiP keeps working and chat sits beneath', async ({ page }) => {
      await open(page, 'mode=screen&cam=on&chat=open&msgs=6');
      const { stage } = await expectStacked(page, vp.height, vp.height <= 640 ? 100 : 150);
      const pip = page.getByTestId('camera-pip');
      await expect(pip).toBeVisible(); await expect(pip).toHaveAttribute('data-pip-live', 'true');
      const p = await rect(page, '[data-testid="camera-pip"]'); const chat = await rect(page, '[data-testid="chat-panel"]');
      expect(p.y + p.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
      expect(p.y + p.height).toBeLessThanOrEqual(chat.y + 1);
      await expect(page.locator('[data-testid="main-stage"] video[aria-label*="sharing their screen"]')).toBeVisible();
    });

    test('E: with the on-screen keyboard open (shorter viewport) the composer and controls stay visible and the video shrinks but remains; layout restores afterwards', async ({ page }) => {
      test.skip(vp.width >= 700, 'keyboard case is a phone case');
      await open(page, 'mode=camera&chat=open&msgs=10');
      const full = await expectStacked(page, vp.height, vp.height <= 640 ? 100 : 150);
      await page.getByRole('textbox', { name: 'Message' }).focus();
      const kbH = Math.round(vp.height * 0.55);                                           // typical keyboard leaves ~55% of the screen
      await page.setViewportSize({ width: vp.width, height: kbH });
      await expect.poll(async () => (await rect(page, '[data-testid="live-room"]')).height).toBeLessThanOrEqual(kbH + 1);   // the frame follows the visible height (next animation frame)
      const shrunk = await expectStacked(page, kbH, 70);
      expect(shrunk.stage.height).toBeLessThanOrEqual(full.stage.height + 1);
      expect(shrunk.composer.y + shrunk.composer.height).toBeLessThanOrEqual(shrunk.controls.y + 1);
      expect(await page.getByRole('textbox', { name: 'Message' }).evaluate((el) => el === document.activeElement)).toBe(true);   // input keeps focus
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await expect.poll(async () => (await rect(page, '[data-testid="live-room"]')).height).toBeGreaterThanOrEqual(vp.height - 1);
      const back = await expectStacked(page, vp.height, vp.height <= 640 ? 100 : 150);
      expect(Math.abs(back.stage.height - full.stage.height)).toBeLessThanOrEqual(1);
    });
  });
}

for (const vp of [
  { name: 'phone landscape 844x390', width: 844, height: 390, mobile: true },
  { name: 'phone landscape 667x375', width: 667, height: 375, mobile: true },
  { name: 'tablet landscape 1024x768', width: 1024, height: 768, mobile: false },
  { name: 'desktop 1280x720', width: 1280, height: 720, mobile: false },
]) {
  test(`landscape / desktop ${vp.name}: chat is a column BESIDE the video; composer and controls visible; nothing overlaps`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile });
    const page = await ctx.newPage();
    await open(page, 'mode=camera&chat=open&msgs=30');
    const stage = await rect(page, '[data-testid="stage-box"]'); const chat = await rect(page, '[data-testid="chat-panel"]');
    const controls = await rect(page, '[data-testid="controls"]'); const composer = await rect(page, '[data-testid="chat-composer"]');
    expect(stage.x + stage.width).toBeLessThanOrEqual(chat.x + 1);                       // side by side, no overlap
    expect(chat.x + chat.width).toBeLessThanOrEqual(vp.width + 1);
    expect(stage.width).toBeGreaterThanOrEqual(vp.width * 0.5);                          // the video keeps the larger share
    expect(stage.height).toBeGreaterThanOrEqual(150);
    expect(chat.y + chat.height).toBeLessThanOrEqual(controls.y + 1);
    expect(composer.y + composer.height).toBeLessThanOrEqual(controls.y + 1);
    expect(controls.y + controls.height).toBeLessThanOrEqual(vp.height + 1);
    await expect(page.getByTestId('chat-panel')).toHaveCSS('position', 'relative');
    const sizes = await page.getByTestId('chat-messages').evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
    expect(sizes.sh).toBeGreaterThan(sizes.ch);
    await noHorizontalOverflow(page); await noPageScroll(page);
    await page.getByRole('button', { name: 'Close chat' }).first().click();
    await expect(page.getByTestId('chat-panel')).toHaveCount(0);
    const restored = await rect(page, '[data-testid="stage-box"]');
    expect(restored.width).toBeGreaterThan(stage.width);                                // video expands again
    await ctx.close();
  });
}

test('a failed send keeps the typed text so nothing is lost', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await open(page, 'mode=camera&chat=open&fail=1');
  await page.getByRole('textbox', { name: 'Message' }).fill('this will fail');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('this will fail');
  await ctx.close();
});
