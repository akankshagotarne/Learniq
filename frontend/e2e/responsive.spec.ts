/**
 * Responsive layout regression test: every page, at 15 widths from 320px phones to 1920px desktops,
 * must not stick out past the edge of the screen (see layout.ts) and must not throw a JavaScript error.
 */
import fs from 'fs';
import { test, expect } from '@playwright/test';
import { mockApi } from './mockApi';
import { findOverflow } from './layout';
import { ROUTES, WIDTHS, heightFor } from './routes';

const SHOTS = process.env.SCREENSHOTS ? 'e2e-screenshots' : '';
const ONLY = process.env.WIDTHS ? process.env.WIDTHS.split(',').map(Number) : WIDTHS;

for (const route of ROUTES) {
  test(`no horizontal overflow: ${route.name} (${route.path})`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await mockApi(page, route.role);

    const problems: string[] = [];
    for (const width of ONLY) {
      await page.setViewportSize({ width, height: heightFor(width) });
      await page.goto(route.path);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(250); // let late layout (fonts, charts) settle
      const report = await findOverflow(page);
      if (report.scrollWidth > report.viewport + 1) problems.push(`${width}px: page is ${report.scrollWidth}px wide`);
      for (const o of report.offenders) problems.push(`${width}px: ${o.selector} [${o.left}..${o.right}] "${o.text}"`);
      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: `${SHOTS}/${route.name}-${width}.png`, fullPage: true });
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
    expect(errors, errors.join('\n')).toEqual([]);
  });
}

// Phones held sideways: short and wide
const LANDSCAPE = [{ width: 740, height: 360 }, { width: 844, height: 390 }];
const LANDSCAPE_ROUTES = ['home', 'student-exams', 'exam-taker', 'olympiad-taker', 'olympiad-result', 'ai-interview', 'login', 'admin-students'];
for (const route of ROUTES.filter((r) => LANDSCAPE_ROUTES.includes(r.name))) {
  test(`no horizontal overflow in landscape: ${route.name}`, async ({ page }) => {
    await mockApi(page, route.role);
    const problems: string[] = [];
    for (const vp of LANDSCAPE) {
      await page.setViewportSize(vp);
      await page.goto(route.path);
      await page.waitForLoadState('networkidle');
      const report = await findOverflow(page);
      if (report.scrollWidth > report.viewport + 1) problems.push(`${vp.width}×${vp.height}: page is ${report.scrollWidth}px wide`);
      for (const o of report.offenders) problems.push(`${vp.width}×${vp.height}: ${o.selector} "${o.text}"`);
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
}
