/**
 * Live class stage: the whole teacher camera frame fits on a phone held upright, and a screen share shows the teacher's live camera in a
 * picture-in-picture. Uses the real MainStage / StageBox with generated video (/__e2e/live-stage, present in the e2e build only).
 * The signalling / track rules are covered by tests-unit/liveScreenPip.test.ts.
 */
import { test, expect, type Page } from '@playwright/test';

const SIZES = [
  { name: 'phone portrait 390x844', width: 390, height: 844, portraitPhone: true },
  { name: 'phone portrait narrow 360x640', width: 360, height: 640, portraitPhone: true },
  { name: 'phone landscape 844x390', width: 844, height: 390, portraitPhone: false },
  { name: 'tablet 768x1024', width: 768, height: 1024, portraitPhone: true },
  { name: 'desktop 1280x720', width: 1280, height: 720, portraitPhone: false },
];

const open = async (page: Page, qs: string) => {
  await page.goto(`/__e2e/live-stage?${qs}`);
  await expect(page.getByTestId('main-stage')).toBeVisible();
};
const box = async (page: Page, sel: string) => { const b = await page.locator(sel).first().boundingBox(); expect(b, sel).not.toBeNull(); return b!; };

for (const s of SIZES) {
  test.describe(s.name, () => {
    test.use({ viewport: { width: s.width, height: s.height } });

    test('camera: the whole frame is shown (contain, no crop, no stretch), controls stay on screen, no sideways scroll', async ({ page }) => {
      await open(page, 'mode=camera&cam=on');
      const video = page.locator('[data-testid="main-stage"] video').first();
      await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);
      const info = await video.evaluate((v: HTMLVideoElement) => ({ fit: getComputedStyle(v).objectFit, vw: v.videoWidth, vh: v.videoHeight, w: v.clientWidth, h: v.clientHeight, mirrored: getComputedStyle(v).transform }));
      expect(info.fit).toBe('contain');
      // with contain the frame is scaled uniformly: the drawn picture is never wider/taller than the box, and it is the full 16:9 frame
      const scale = Math.min(info.w / info.vw, info.h / info.vh);
      const drawnW = info.vw * scale; const drawnH = info.vh * scale;
      expect(drawnW).toBeLessThanOrEqual(info.w + 1); expect(drawnH).toBeLessThanOrEqual(info.h + 1);
      expect(info.mirrored === 'none' || info.mirrored === 'matrix(1, 0, 0, 1, 0, 0)').toBe(true); // a remote teacher is never mirrored / rotated
      if (s.portraitPhone) {
        const stage = await box(page, '[data-testid="stage-box"]');
        expect(Math.abs(stage.width / stage.height - 16 / 9)).toBeLessThan(0.06);       // landscape-style area
        expect(drawnW).toBeGreaterThanOrEqual(info.w - 3);                              // the full width of the frame fills the area (nothing cut off at the sides)
        expect(stage.width).toBeGreaterThan(s.width - 24);                              // uses the available width
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const controls = await box(page, '[data-testid="controls"]');
      expect(controls.y + controls.height).toBeLessThanOrEqual(s.height + 1);
      expect(controls.y).toBeGreaterThanOrEqual(0);
      const stage = await box(page, '[data-testid="main-stage"]');
      expect(stage.y + stage.height).toBeLessThanOrEqual(controls.y + 1);                // the stage never runs under the control bar
    });

    test('screen share: the screen is the large main content and the live teacher camera sits in a small corner PiP', async ({ page }) => {
      await open(page, 'mode=screen&cam=on');
      const stage = await box(page, '[data-testid="main-stage"]');
      const main = page.locator('[data-testid="main-stage"] video[aria-label*="sharing their screen"]');
      await expect(main).toBeVisible();
      const pip = page.getByTestId('camera-pip');
      await expect(pip).toBeVisible();
      await expect(pip).toHaveAttribute('data-pip-live', 'true');
      const pipVideo = pip.locator('video');
      await expect.poll(() => pipVideo.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);   // real camera frames, not an avatar
      await expect.poll(() => main.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);
      const p = await box(page, '[data-testid="camera-pip"]');
      const m = await box(page, '[data-testid="main-stage"] video[aria-label*="sharing their screen"]');
      // anchored inside the stage, lower-right corner, small
      expect(p.x).toBeGreaterThanOrEqual(stage.x); expect(p.y).toBeGreaterThanOrEqual(stage.y);
      expect(p.x + p.width).toBeLessThanOrEqual(stage.x + stage.width + 1); expect(p.y + p.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
      expect(p.x + p.width / 2).toBeGreaterThan(stage.x + stage.width * 0.6); expect(p.y + p.height / 2).toBeGreaterThan(stage.y + stage.height * 0.55);
      expect(p.width).toBeLessThanOrEqual(stage.width * 0.35); expect(p.width * p.height).toBeLessThan(m.width * m.height * 0.12);
      expect(Math.abs(p.width / p.height - 16 / 9)).toBeLessThan(0.08);                      // consistent aspect ratio
      expect(m.width * m.height).toBeGreaterThan(stage.width * stage.height * 0.9);          // the screen stays the largest area
      // the PiP is on top of the screen video and does not cover the control bar
      const onTop = await page.evaluate(() => { const r = document.querySelector('[data-testid="camera-pip"]')!.getBoundingClientRect(); const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!el && !!el.closest('[data-testid="camera-pip"]'); });
      expect(onTop).toBe(true);
      const controls = await box(page, '[data-testid="controls"]');
      expect(p.y + p.height).toBeLessThanOrEqual(controls.y);
      const fit = await main.evaluate((v: HTMLVideoElement) => getComputedStyle(v).objectFit); expect(fit).toBe('contain');   // the shared screen is never cropped
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); expect(overflow).toBeLessThanOrEqual(0);
    });

    test('screen share with the teacher camera off: the PiP reflects that (initials, not a fake live picture)', async ({ page }) => {
      await open(page, 'mode=screen&cam=off');
      const pip = page.getByTestId('camera-pip');
      await expect(pip).toBeVisible();
      await expect(pip).toHaveAttribute('data-pip-live', 'false');
      await expect(pip.locator('video')).toHaveCount(0);
      await expect(pip).toContainText('camera is off');
    });
  });
}

test('without a screen share there is no PiP and the normal teacher video layout is shown', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'mode=camera&cam=on');
  await expect(page.getByTestId('camera-pip')).toHaveCount(0);
  await expect(page.getByTestId('main-stage')).toHaveAttribute('data-stage-kind', 'host');
  await expect(page.getByTestId('thumbnails')).toBeVisible();
});
