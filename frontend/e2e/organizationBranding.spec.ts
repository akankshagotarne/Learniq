/**
 * Virat Education Society on the public website: LearnIQ stays the primary brand; the society line sits under the logo; the
 * About page explains the relationship and shows the official details as real text; the Contact page keeps LearnIQ Support
 * and the society's contact clearly apart; nothing overlaps at phone, tablet or desktop width.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './mockApi';

const REG1 = 'MAH-93/19-(0222228)'; const REG2 = 'F-25431(6750)';
const AFF = 'An Initiative of Virat Education Society';
const WIDTHS = [320, 360, 414, 768, 1024, 1280, 1920];

/** bounding boxes of the visible navbar logo, affiliation line and every visible navbar control */
const navGeometry = (page: Page) => page.evaluate(() => {
  const nav = document.querySelector('nav')!; const r = (e: Element) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
  const vis = (e: Element) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const line = [...nav.querySelectorAll('[data-testid="society-affiliation"]')].find(vis)!;
  const logo = [...nav.querySelectorAll('img[alt="LearnIQ"]')].find(vis)!;
  const controls = [...nav.querySelectorAll('a, button')].filter(vis).filter((e) => !e.contains(logo));
  return { nav: r(nav), line: r(line), lineText: line.textContent, logo: r(logo), logoText: getComputedStyle(logo.parentElement!.querySelector('span')!).fontSize, lineFont: getComputedStyle(line).fontSize, controls: controls.map(r) };
});
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

test('A: navbar - LearnIQ logo unchanged and primary, affiliation line beneath it, no overlap, nav links intact, every width', async ({ page }) => {
  await mockApi(page, 'guest');
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await expect(page.locator('nav [data-testid="society-affiliation"]:visible')).toHaveCount(1);
    const g = await navGeometry(page);
    expect(g.lineText).toBe(AFF);
    expect(g.line.y).toBeGreaterThanOrEqual(g.logo.y + g.logo.h - 2);                     // beneath the logo
    expect(parseFloat(g.lineFont)).toBeLessThan(parseFloat(g.logoText) / 1.5);            // secondary: far smaller than "LearnIQ"
    expect(g.line.y + g.line.h).toBeLessThanOrEqual(g.nav.y + g.nav.h);                     // inside the 64 px bar (no taller navbar)
    expect(g.nav.h).toBeLessThanOrEqual(66);
    for (const c of g.controls) expect(overlaps(g.line, c), `${width}px: affiliation overlaps a control`).toBe(false);
    expect(g.line.x + g.line.w).toBeLessThanOrEqual(width);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const label of ['Home', 'Live Classes', 'About', 'Contact']) await expect(page.locator('nav').getByRole('link', { name: label, exact: true })).toBeVisible();
});

test('B: About page - relationship explained, both registrations + dates, office, phones and email as real text; anchor link works', async ({ page }) => {
  await mockApi(page, 'guest');
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/about');
    const s = page.getByTestId('about-society');
    await expect(s.getByRole('heading', { name: 'About LearnIQ & Virat Education Society' })).toBeVisible();
    await expect(s).toContainText('LearnIQ is an educational initiative operating under Virat Education Society');
    await expect(page.getByTestId('society-reg-1')).toHaveText(REG1);
    await expect(page.getByTestId('society-reg-2')).toHaveText(REG2);
    const regs = page.getByTestId('society-registrations');
    await expect(regs).toContainText('16 February 2019'); await expect(regs).toContainText('25 May 2019');
    const addr = page.getByTestId('society-address');
    for (const l of ['Plot No. 13, Ramgopalnagar', 'Nashik Road, Padegaon', 'District: Chharapati Sambhajinagar', 'Maharashtra – 431001']) await expect(addr).toContainText(l);
    await expect(page.getByTestId('society-contacts').getByRole('link', { name: '9765550636' })).toHaveAttribute('href', 'tel:+919765550636');
    await expect(page.getByTestId('society-contacts').getByRole('link', { name: '9860182080' })).toHaveAttribute('href', 'tel:+919860182080');
    await expect(page.getByTestId('society-contacts').getByRole('link', { name: 'cool00mayur@gmail.com' })).toHaveAttribute('href', 'mailto:cool00mayur@gmail.com');
    await expect(page.locator('img[alt="Virat Education Society emblem"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await expect(page).toHaveTitle('About LearnIQ & Virat Education Society');
  const ld = JSON.parse(await page.locator('#ld-organization').textContent() || '{}');
  expect(ld.name).toBe('LearnIQ'); expect(ld.parentOrganization.name).toBe('Virat Education Society');
  // existing About content is still there
  await expect(page.getByRole('heading', { name: 'Who We Are' })).toBeVisible();
  await expect(page.getByText('Prof. Mayur Raut').first()).toBeVisible();
  // footer link -> the section
  await page.goto('/');
  await page.locator('footer').getByRole('link', { name: 'About Virat Education Society' }).click();
  await expect(page).toHaveURL(/\/about#virat-education-society$/);
  await expect(page.getByTestId('about-society')).toBeInViewport({ timeout: 5000 });
});

test('C: footer + Contact - LearnIQ Support kept and labelled; society details labelled separately; no contradictory duplicates', async ({ page }) => {
  await mockApi(page, 'guest');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/contact');
  const footer = page.locator('footer');
  await expect(footer.getByTestId('footer-society')).toContainText(`LearnIQ — ${AFF}`);
  await expect(footer.getByTestId('footer-society')).toContainText(`${REG1} | ${REG2}`);
  await expect(footer.getByText('LearnIQ Support')).toBeVisible();
  await expect(footer.getByRole('link', { name: 'learniq.admin@gmail.com' })).toBeVisible();
  // Contact page: LearnIQ support cards unchanged in value, clearly named
  await expect(page.getByText('Call LearnIQ Support')).toBeVisible(); await expect(page.getByText('Email LearnIQ Support')).toBeVisible();
  await expect(page.getByText('learniq.admin@gmail.com').first()).toBeVisible();
  const sc = page.getByTestId('society-contact');
  await expect(sc.getByRole('heading', { name: 'Virat Education Society' })).toBeVisible();
  await expect(sc).toContainText('District: Chharapati Sambhajinagar'); await expect(sc).toContainText('cool00mayur@gmail.com');
  await expect(sc).not.toContainText('learniq.admin@gmail.com');
  // the registration numbers appear once per page in the footer and nowhere contradictory
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/MAH-93\/19-0222228|MAH-93\/19\(0222228\)|F-25431 \(6750\)/); // no mangled variants anywhere
  // the affiliation wording is identical everywhere it appears
  const all = await page.getByTestId('society-affiliation').allTextContents();
  expect(new Set(all)).toEqual(new Set([AFF]));
});

test('login, register and certificate verification pages show the affiliation under the logo; dashboards do not get the society address', async ({ page }) => {
  await mockApi(page, 'guest');
  for (const p of ['/login', '/register', '/verify-certificate/LIQ-OLY-2026-000123']) {
    await page.goto(p);
    await expect(page.getByTestId('society-affiliation').first()).toHaveText(AFF);
  }
  await mockApi(page, 'student');
  await page.goto('/student');
  await expect(page.getByText('cool00mayur@gmail.com')).toHaveCount(0);
  await expect(page.getByText('Ramgopalnagar')).toHaveCount(0);
});
