/**
 * Layout checks that run inside the page.
 *
 * findOverflow() lists the elements that stick out past the left/right edge of the viewport. An element that sits
 * inside its own horizontal scroll container (a scrollable tab or filter row, a wide table wrapper) is NOT reported:
 * that scrolling is intentional and contained. `document.body` does not count as a container, so a site-wide
 * `overflow-x: hidden` can never hide a real problem from this check.
 */
import type { Page } from '@playwright/test';

export interface Offender { selector: string; text: string; left: number; right: number; width: number }
export interface OverflowReport { viewport: number; scrollWidth: number; offenders: Offender[] }

export async function findOverflow(page: Page): Promise<OverflowReport> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const describe = (el: Element) => {
      const id = el.id ? `#${el.id}` : '';
      const testId = el.getAttribute('data-testid') ? `[data-testid="${el.getAttribute('data-testid')}"]` : '';
      const cls = typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).slice(0, 4).join('.')}` : '';
      return `${el.tagName.toLowerCase()}${id}${testId}${cls === '.' ? '' : cls}`;
    };
    const containedByScroller = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox !== 'visible') {
          const r = p.getBoundingClientRect();
          if (r.left >= -1 && r.right <= vw + 1) return true;
        }
      }
      return false;
    };
    const hidden = (el: Element) => {
      for (let n: Element | null = el; n; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.display === 'none' || s.visibility === 'hidden') return true;
      }
      return false;
    };
    const found: Element[] = [];
    document.body.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      if (r.right <= vw + 1 && r.left >= -1) return;
      if (containedByScroller(el) || hidden(el)) return;
      found.push(el);
    });
    // report only the outermost offenders (their children overflow because they do)
    const outermost = found.filter((el) => !found.some((o) => o !== el && o.contains(el)));
    return {
      viewport: vw,
      scrollWidth: document.documentElement.scrollWidth,
      offenders: outermost.slice(0, 12).map((el) => {
        const r = el.getBoundingClientRect();
        return { selector: describe(el), text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
      }),
    };
  });
}

/** Interactive controls whose tappable box is smaller than `min` px in either direction (visible ones only). */
export async function smallTapTargets(page: Page, min = 32): Promise<string[]> {
  return page.evaluate((m) => {
    const out: string[] = [];
    document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.display === 'none') return;
      if (el.closest('[aria-hidden="true"], [inert]')) return;
      if (r.width < m || r.height < m) out.push(`${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
    });
    return out;
  }, min);
}
