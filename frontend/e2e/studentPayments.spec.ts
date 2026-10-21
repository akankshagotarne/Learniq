/** Student Payments & Transactions UI with a mocked API (ownership, eligibility and receipt content are covered in backend/src/tests/studentTransactions.test.js). */
import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './mockApi';
import { findOverflow } from './layout';

const pay = (i: number, o: any = {}) => ({
  id: `pay_${String(i).padStart(24, '0')}`, kind: 'PAYMENT', type: 'EXAM_PAYMENT', description: 'Exam Payment', detail: 'LearnIQ Test Std 10', component: 'EXAM', componentLabel: 'Exam',
  amount: 10, currency: 'INR', creditChange: null, method: 'upi', methodLabel: 'UPI', status: 'SUCCESS', statusLabel: 'Success', date: new Date(Date.now() - i * 3600e3).toISOString(),
  transactionId: `TXN20261018ABCDE${i}${i}`, receiptNumber: null, receiptAvailable: true, ...o,
});
const cr = (i: number, delta: number, label: string, type: string) => ({
  id: `crd_${String(i).padStart(24, '0')}`, kind: 'CREDIT', type, description: label, detail: '', component: 'CREDIT', componentLabel: 'Credit', amount: null, currency: null, creditChange: delta,
  method: null, methodLabel: 'Exam Credit', status: 'SUCCESS', statusLabel: 'Success', date: new Date(Date.now() - i * 3600e3).toISOString(), transactionId: `CRD20261018ABCDE${i}${i}`, receiptNumber: null, receiptAvailable: false, statementAvailable: true,
});
const rows = [pay(1), pay(2, { type: 'INTERVIEW_PAYMENT', description: 'Interview Payment', component: 'INTERVIEW', componentLabel: 'Interview' }), pay(3, { status: 'PENDING', statusLabel: 'Pending', receiptAvailable: false }), cr(4, 1, 'Referral Reward', 'REFERRAL_CREDIT'), cr(5, -1, 'Exam Credit Used', 'EXAM_CREDIT_USED')];
const summary = { money: { totalPaid: 20, successfulCount: 2, pendingCount: 1, failedCount: 0, refundedAmount: 0, currency: 'INR' }, credits: { earned: 1, grantedByAdmin: 0, used: 1, balance: 0 } };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

async function setup(page: Page, opts: { rows?: any[]; failList?: () => boolean } = {}) {
  const calls: string[] = []; const downloads: string[] = [];
  await mockApi(page, 'student');
  await page.route('**/api/student-transactions**', async (route) => {
    const u = new URL(route.request().url()); const path = u.pathname.replace(/^.*\/student-transactions/, '');
    calls.push(`${route.request().method()} ${path}${u.search}`);
    if (path === '' || path === '/') {
      if (opts.failList?.()) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'boom' }) });
      const tab = u.searchParams.get('tab'); const search = u.searchParams.get('search') || '';
      let list = (opts.rows || rows).filter((r) => (tab === 'payments' ? r.kind === 'PAYMENT' : tab === 'credits' ? r.kind === 'CREDIT' : true));
      if (search) list = list.filter((r) => r.transactionId.includes(search));
      const limit = Number(u.searchParams.get('limit') || 10); const page_ = Number(u.searchParams.get('page') || 1);
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, items: list.slice((page_ - 1) * limit, page_ * limit), pagination: { page: page_, limit, total: list.length, pages: Math.max(1, Math.ceil(list.length / limit)) }, summary }) });
    }
    if (path === '/receipts') { downloads.push('bulk'); return route.fulfill({ status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="LearnIQ_Payment_Receipts_20261021.pdf"', 'x-receipts-included': '2', 'x-receipts-excluded': '0', 'access-control-expose-headers': '*' }, body: PDF }); }
    if (/\/receipt$/.test(path)) { downloads.push(path); return route.fulfill({ status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="LearnIQ_Receipt_LQ-REC-2026-000001.pdf"', 'access-control-expose-headers': '*' }, body: PDF }); }
    if (/\/statement$/.test(path)) { downloads.push(path); return route.fulfill({ status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="LearnIQ_Credit_Statement_X.pdf"', 'access-control-expose-headers': '*' }, body: PDF }); }
    const row = rows.find((r) => `/${r.id}` === path);
    if (!row) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Transaction not found.' }) });
    const extra = row.kind === 'PAYMENT'
      ? { purpose: 'LearnIQ Test Std 10 — Exam Access', student: { name: 'Virat Raut', email: 'v@example.com', phone: '+91 XXXXXX9972', standard: 'Standard 10', studentId: 'LQS-1A2B3C4D', accountType: 'Student' }, payment: { razorpayOrderId: 'order_X1', razorpayPaymentId: 'pay_X1', verifiedAt: row.date, paymentMethod: 'UPI via Razorpay', failureNote: null } }
      : { credit: { source: 'REFERRAL', reason: null, relatedTitle: null, balanceAfter: 1, moneyReceived: 0 } };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, transaction: { ...row, ...extra } }) });
  });
  return { calls, downloads };
}
const open = async (page: Page) => { await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('/student/payments'); await expect(page.getByTestId('tx-table')).toBeVisible(); };

test('sidebar entry (student only) opens the page; summary keeps money and credits apart', async ({ page }) => {
  await setup(page); await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('/student'); await page.locator('aside nav a').first().waitFor();
  const labels = (await page.locator('aside nav a').allInnerTexts()).map((t) => t.trim());
  expect(labels.filter((l) => l === 'Payments & Transactions')).toHaveLength(1);
  await page.locator('aside nav a', { hasText: 'Payments & Transactions' }).click();
  await expect(page).toHaveURL(/\/student\/payments$/);
  await expect(page.getByRole('heading', { name: 'Payments & Transactions' })).toBeVisible();
  await expect(page.getByText('View your payments, track exam credits, and download your receipts.')).toBeVisible();
  await expect(page.getByTestId('sum-total')).toHaveText('₹20'); await expect(page.getByTestId('sum-success')).toHaveText('2'); await expect(page.getByTestId('sum-pending')).toHaveText('1');
  await expect(page.getByTestId('cr-balance')).toHaveText('0'); await expect(page.getByTestId('cr-earned')).toHaveText('1'); await expect(page.getByTestId('cr-used')).toHaveText('1');
  await page.reload(); await expect(page.getByTestId('tx-table')).toBeVisible(); // refresh works
});

test('tabs show payments only / credits only; credit rows have a statement, never a receipt', async ({ page }) => {
  await setup(page); await open(page);
  await expect(page.getByTestId('tx-table').getByTestId('tx-row')).toHaveCount(5);
  await page.getByTestId('tab-payments').click(); await expect(page.getByTestId('tx-table').getByTestId('tx-row')).toHaveCount(3);
  await page.getByTestId('tab-credits').click(); await expect(page.getByTestId('tx-table').getByTestId('tx-row')).toHaveCount(2);
  await expect(page.getByTestId('tx-table').getByTestId('tx-receipt')).toHaveCount(0); await expect(page.getByTestId('tx-table').getByTestId('tx-statement')).toHaveCount(2);
  await expect(page.getByTestId('tx-table').getByTestId('tx-row').first()).toContainText('+1 Credit');
  await page.getByTestId('tab-all').click();
  await expect(page.getByTestId('tx-table').getByTestId('tx-receipt')).toHaveCount(2); // pending payment has none
});

test('filters and search are sent to the server and reset the page', async ({ page }) => {
  const { calls } = await setup(page); await open(page);
  await page.getByTestId('f-status').selectOption('SUCCESS'); await page.getByTestId('f-range').selectOption('current_month'); await page.getByTestId('f-method').selectOption('upi');
  await page.getByTestId('tx-search').fill('ABCDE1');
  await expect.poll(() => calls.some((c) => c.includes('status=SUCCESS') && c.includes('range=current_month') && c.includes('method=upi') && c.includes('search=ABCDE1') && c.includes('page=1'))).toBe(true);
  await expect(page.getByTestId('tx-table').getByTestId('tx-row')).toHaveCount(1);
  await page.getByTestId('f-range').selectOption('custom'); await page.getByTestId('f-from').fill('2026-10-01'); await page.getByTestId('f-to').fill('2026-10-31');
  await expect.poll(() => calls.some((c) => c.includes('from=2026-10-01') && c.includes('to=2026-10-31') && !c.includes('range='))).toBe(true);
  await page.getByTestId('f-reset').click(); await expect(page.getByTestId('tx-table').getByTestId('tx-row')).toHaveCount(5);
});

test('details modal for a payment and a credit; receipt downloads a real PDF file', async ({ page }) => {
  const { downloads } = await setup(page); await open(page);
  await page.getByTestId('tx-table').getByTestId('tx-view').first().click();
  const dlg = page.getByTestId('tx-detail');
  await expect(dlg).toContainText('Razorpay order ID'); await expect(dlg).toContainText('order_X1'); await expect(dlg).toContainText('UPI via Razorpay'); await expect(dlg).not.toContainText(/signature/i);
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId('tx-detail-receipt').click()]);
  expect(file.suggestedFilename()).toBe('LearnIQ_Receipt_LQ-REC-2026-000001.pdf');
  const buf = await (await import('fs')).promises.readFile((await file.path())!); expect(buf.slice(0, 5).toString()).toBe('%PDF-');
  expect(downloads.some((d) => d.endsWith('/receipt'))).toBe(true);
  await page.keyboard.press('Escape'); await expect(dlg).toHaveCount(0);
  await page.getByTestId('tab-credits').click(); await page.getByTestId('tx-table').getByTestId('tx-view').first().click();
  await expect(page.getByTestId('tx-detail')).toContainText('₹0.00'); await expect(page.getByTestId('tx-detail')).not.toContainText('Razorpay');
  const [st] = await Promise.all([page.waitForEvent('download'), page.getByTestId('tx-detail-statement').click()]);
  expect(st.suggestedFilename()).toContain('Credit_Statement');
});

test('bulk download: only receipt-eligible rows are selectable, one combined PDF', async ({ page }) => {
  const { downloads } = await setup(page); await open(page);
  await page.getByTestId('tab-payments').click();
  await expect(page.getByTestId('bulk-download')).toBeDisabled();
  const boxes = page.getByTestId('tx-table').getByTestId('tx-select'); await expect(boxes).toHaveCount(3);
  await expect(boxes.nth(2)).toBeDisabled(); // the pending payment
  await boxes.nth(0).check(); await boxes.nth(1).check(); await expect(page.getByTestId('sel-count')).toHaveText('2 selected');
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId('bulk-download').click()]);
  expect(file.suggestedFilename()).toBe('LearnIQ_Payment_Receipts_20261021.pdf'); expect(downloads).toContain('bulk');
  await expect(page.getByTestId('sel-count')).toHaveText('0 selected');
});

test('receipt failure keeps the payment and shows a safe message', async ({ page }) => {
  await setup(page); await page.route('**/api/student-transactions/*/receipt', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, message: "We couldn't generate your receipt right now. Your verified payment remains recorded. Please try again." }) }));
  await open(page); await page.getByTestId('tx-table').getByTestId('tx-receipt').first().click();
  await expect(page.getByText("We couldn't generate your receipt right now.")).toBeVisible(); await expect(page.getByTestId('tx-table').getByTestId('tx-row')).toHaveCount(5);
});

test('states: empty, no matches, error with retry', async ({ page }) => {
  let fail = true; await setup(page, { failList: () => fail }); await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('/student/payments');
  await expect(page.getByTestId('tx-error')).toBeVisible(); fail = false; await page.getByTestId('tx-retry').click(); await expect(page.getByTestId('tx-table')).toBeVisible();
  await page.getByTestId('tx-search').fill('NOPE'); await expect(page.getByTestId('tx-empty')).toContainText('No transactions match your filters.');
  const p2 = await page.context().newPage(); await setup(p2, { rows: [] }); await p2.goto('/student/payments');
  await expect(p2.getByTestId('tx-empty')).toContainText('No transactions yet.');
});

for (const w of [320, 360, 390, 430, 768]) {
  test(`responsive ${w}px: no horizontal overflow`, async ({ page }) => {
    await setup(page); await page.setViewportSize({ width: w, height: 900 }); await page.goto('/student/payments');
    if (w < 768) await expect(page.getByTestId('tx-cards')).toBeVisible(); else await expect(page.getByTestId('tx-table')).toBeVisible();
    const rep = await findOverflow(page); expect(rep.offenders, JSON.stringify(rep.offenders)).toEqual([]);
    if (w < 768) { await page.getByTestId('tx-cards').getByTestId('tx-view').first().click(); await expect(page.getByTestId('tx-detail')).toBeVisible(); const rep2 = await findOverflow(page); expect(rep2.offenders, JSON.stringify(rep2.offenders)).toEqual([]); }
  });
}
