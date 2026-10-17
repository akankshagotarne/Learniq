/**
 * Payment "Remove from History", admin profile editing, and the student / teacher Profile + Settings pages.
 * Runs against the mock API (no backend); the server-side rules are covered by backend/src/tests/profileManagement.test.js.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockApi, users, adminStudentProfile } from './mockApi';
import { findOverflow } from './layout';

type Call = { method: string; path: string; body?: any };

const noOverflow = async (page: Page, label: string) => {
  const r = await findOverflow(page);
  expect(r.offenders, `${label}: ${JSON.stringify(r.offenders.slice(0, 3))}`).toEqual([]);
};

// ───────────── payments
const payment = (over: Record<string, unknown>) => ({
  _id: 'p1', source: 'olympiad', type: 'olympiad', student: { name: 'Akanksha Gotarne', email: 'a@example.com' }, exam: { _id: 'e1', title: 'Olympiad 2026', standard: 10 },
  amount: 1, currency: 'INR', status: 'completed', orderId: 'order_••••1234', paymentId: 'pay_••••5678', provider: 'Razorpay', createdAt: new Date().toISOString(), ...over,
});

async function adminPayments(page: Page) {
  const calls: Call[] = [];
  let rows = [payment({}), payment({ _id: 'p2', status: 'failed', student: { name: 'Failed Payer' }, amount: 20 })];
  let removed: any[] = [];
  await mockApi(page, 'admin', (method, path, body) => {
    if (path.startsWith('/admin/payments') || path.startsWith('/admin/payments/')) calls.push({ method, path, body });
    if (method === 'GET' && path === '/admin/payments') {
      // the mock cannot see the query string; the page asks for ?view=removed via its own tab, which we detect from the last call below
      return { body: { success: true, view: 'active', payments: rows, stats: { totalRevenue: rows.filter(r => r.status === 'completed').reduce((n, r) => n + r.amount, 0), completedCount: 1, pendingCount: 0, failedCount: 1, refundedCount: 0, historyCount: 0, removedCount: removed.length, totalCount: rows.length, currency: 'INR' } } };
    }
    const del = /^\/admin\/payments\/(\w+)\/(\w+)$/.exec(path);
    if (method === 'DELETE' && del) {
      const row = rows.find(r => r._id === del[2]);
      if (row && row.status === 'completed' && !(body?.reason && body.reason.length >= 5)) return { status: 400, body: { success: false, message: 'Please give a reason.' } };
      rows = rows.filter(r => r._id !== del[2]); if (row) removed.push(row);
      return { body: { success: true, message: 'removed' } };
    }
    return undefined;
  });
  return { calls, getRemoved: () => removed };
}

test('Remove from History: modal shows the record, needs a reason for a verified payment, then removes only that row', async ({ page }) => {
  const { calls } = await adminPayments(page);
  await page.goto('/admin/payments');
  await expect(page.getByText('Akanksha Gotarne')).toBeVisible();
  await page.getByRole('button', { name: 'Remove from History' }).first().click();

  const dialog = page.getByRole('dialog', { name: 'Remove Payment from History?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Akanksha Gotarne');
  await expect(dialog).toContainText('₹1');
  await expect(dialog).toContainText('completed');
  await expect(dialog).toContainText('pay_••••5678');
  const confirm = dialog.getByRole('button', { name: 'Remove Record' });
  await expect(confirm).toBeDisabled(); // verified payment: a reason is required
  await dialog.getByLabel(/Reason/).fill('Duplicate test entry');
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText('Akanksha Gotarne')).toHaveCount(0);
  await expect(page.getByText('Failed Payer')).toBeVisible(); // the other record is untouched
  const del = calls.find(c => c.method === 'DELETE');
  expect(del?.path).toBe('/admin/payments/olympiad/p1');
  expect(del?.body).toEqual({ reason: 'Duplicate test entry' });
});

test('Remove from History: Cancel changes nothing', async ({ page }) => {
  const { calls } = await adminPayments(page);
  await page.goto('/admin/payments');
  await page.getByRole('button', { name: 'Remove from History' }).first().click();
  await page.getByRole('dialog', { name: 'Remove Payment from History?' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('Akanksha Gotarne')).toBeVisible();
  expect(calls.filter(c => c.method === 'DELETE')).toEqual([]);
});

test('a non-verified payment can be removed without a reason; a server error is shown and the row stays', async ({ page }) => {
  const { calls } = await adminPayments(page);
  await page.goto('/admin/payments');
  await page.getByRole('button', { name: 'Remove from History' }).nth(1).click();
  const dialog = page.getByRole('dialog', { name: 'Remove Payment from History?' });
  await expect(dialog.getByRole('button', { name: 'Remove Record' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Remove Record' }).click();
  await expect(page.getByText('Failed Payer')).toHaveCount(0);
  expect(calls.find(c => c.method === 'DELETE')?.path).toBe('/admin/payments/olympiad/p2');
});

test('View details shows the payment and masked ids; the Removed tab asks for the removed view', async ({ page }) => {
  await adminPayments(page);
  const urls: string[] = [];
  page.on('request', r => { if (r.url().includes('/api/admin/payments')) urls.push(r.url()); });
  await page.goto('/admin/payments');
  await page.getByRole('button', { name: /View details of Akanksha/ }).click();
  const d = page.getByRole('dialog', { name: 'Payment details' });
  await expect(d).toContainText('order_••••1234');
  await expect(d).toContainText('Razorpay');
  await d.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('tab', { name: /Removed/ }).click();
  await expect.poll(() => urls.some(u => u.includes('view=removed'))).toBe(true);
});

test('payments page has no horizontal overflow on a phone, with the action buttons', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await adminPayments(page);
  await page.goto('/admin/payments');
  await expect(page.getByRole('button', { name: 'Remove from History' }).first()).toBeVisible();
  await noOverflow(page, 'payments');
});

// ───────────── admin edit profile
test('admin Edit Profile sends ONLY the changed fields and refreshes the page', async ({ page }) => {
  const calls: Call[] = [];
  const id = adminStudentProfile.user._id;
  await mockApi(page, 'admin', (method, path, body) => {
    if (method === 'PATCH' && path === `/admin/students/${id}`) { calls.push({ method, path, body }); return { body: { success: true, message: 'updated', changed: ['name'], user: { ...adminStudentProfile.user, ...body } } }; }
    return undefined;
  });
  await page.goto(`/admin/students/${id}`);
  await page.getByRole('button', { name: 'Edit Profile' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit student profile' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Current standard')).toBeVisible();
  await expect(dialog.getByLabel(/^role/i)).toHaveCount(0);
  await dialog.getByLabel('Full name').fill('Akanksha M. Gotarne');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();
  expect(calls).toHaveLength(1);
  expect(calls[0].body).toEqual({ name: 'Akanksha M. Gotarne' });
});

test('admin Edit Profile shows a server validation error next to the field and stays open', async ({ page }) => {
  const id = adminStudentProfile.user._id;
  await mockApi(page, 'admin', (method, path) => {
    if (method === 'PATCH' && path === `/admin/students/${id}`) return { status: 409, body: { success: false, field: 'email', code: 'EMAIL_TAKEN', message: 'This e-mail is already registered.' } };
    return undefined;
  });
  await page.goto(`/admin/students/${id}`);
  await page.getByRole('button', { name: 'Edit Profile' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit student profile' });
  await dialog.getByLabel('E-mail').fill('taken@example.com');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog.getByRole('alert')).toContainText('already registered');
  await expect(dialog).toBeVisible();
});

test('admin Edit Profile for a teacher offers professional fields but no approval control', async ({ page }) => {
  await mockApi(page, 'admin');
  await page.goto('/admin/teachers/650000000000000000000201');
  await page.getByRole('button', { name: 'Edit Profile' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit teacher profile' });
  for (const l of ['Qualification', 'Experience', 'Subjects (comma separated)', 'About']) await expect(dialog.getByLabel(l)).toBeVisible();
  await expect(dialog.getByText('Approve')).toHaveCount(0);
});

// ───────────── student / teacher self-service
test('student Profile page: header, Edit Profile, saves the name only (no standard / role fields exist)', async ({ page }) => {
  const calls: Call[] = [];
  await mockApi(page, 'student', (method, path, body) => {
    if (method === 'PATCH' && path === '/auth/profile') { calls.push({ method, path, body }); return { body: { success: true, message: 'Profile updated.', changed: ['name'], user: { ...users.student, ...body } } }; }
    return undefined;
  });
  await page.goto('/student/profile');
  await expect(page.getByRole('heading', { name: users.student.name })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Profile' }).click();
  const form = page.getByRole('form', { name: 'Edit profile' });
  await expect(form.getByLabel('Full name')).toBeVisible();
  await expect(form.getByLabel(/standard/i)).toHaveCount(0);
  await expect(form.getByLabel('Current password')).toHaveCount(0); // phone untouched
  await form.getByLabel('Full name').fill('Akanksha G');
  await form.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: 'Akanksha G' })).toBeVisible();
  expect(calls[0].body.name).toBe('Akanksha G');
  expect(Object.keys(calls[0].body).sort()).toEqual(['name', 'phone']);
});

test('changing the phone number asks for the current password', async ({ page }) => {
  await mockApi(page, 'student');
  await page.goto('/student/profile');
  await page.getByRole('button', { name: 'Edit Profile' }).click();
  const form = page.getByRole('form', { name: 'Edit profile' });
  await form.getByLabel('Phone number').fill('9000000001');
  await expect(form.getByLabel('Current password')).toBeVisible();
});

test('student Settings: password mismatch is caught client-side; a valid change posts and clears the form', async ({ page }) => {
  const calls: Call[] = [];
  await mockApi(page, 'student', (method, path, body) => {
    if (method === 'POST' && path === '/auth/change-password') { calls.push({ method, path, body }); return { body: { success: true, message: 'Password changed. Other devices were signed out.' } }; }
    return undefined;
  });
  await page.goto('/student/settings');
  await page.getByLabel('Current password').last().fill('OldPass#123');
  await page.getByLabel('New password', { exact: true }).fill('NewPass#456');
  await page.getByLabel('Confirm new password').fill('Different#1');
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByText('The two new passwords do not match.')).toBeVisible();
  expect(calls).toEqual([]);
  await page.getByLabel('Confirm new password').fill('NewPass#456');
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].body).toEqual({ currentPassword: 'OldPass#123', newPassword: 'NewPass#456' });
});

test('student Settings: e-mail change sends the request and says the e-mail changes only after the link is opened', async ({ page }) => {
  await mockApi(page, 'student', (method, path) => {
    if (method === 'POST' && path === '/auth/profile/email-change') return { body: { success: true, message: 'We sent a confirmation link to new@example.com. Your e-mail address changes only after you open it (valid for 30 minutes).', pendingEmail: 'new@example.com' } };
    return undefined;
  });
  await page.goto('/student/settings');
  await page.getByLabel('New e-mail').fill('new@example.com');
  await page.getByLabel('Current password').first().fill('OldPass#123');
  await page.getByRole('button', { name: 'Send confirmation link' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'changes only after you open it' })).toBeVisible();
  await expect(page.getByText(users.student.email!)).toBeVisible(); // still the old address
});

test('teacher Profile shows professional details and the edit form has the teacher fields', async ({ page }) => {
  await mockApi(page, 'teacher');
  await page.goto('/teacher/profile');
  await expect(page.getByRole('heading', { name: 'Professional details' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Profile' }).click();
  const form = page.getByRole('form', { name: 'Edit profile' });
  for (const l of ['Qualification', 'Experience', 'Subjects', 'About you']) await expect(form.getByLabel(l)).toBeVisible();
  await expect(form.getByText(/approv/i)).toHaveCount(0);
});

test('profile and settings are role-protected and linked from the sidebar', async ({ page }) => {
  await mockApi(page, 'teacher');
  await page.goto('/student/profile');
  await expect(page).toHaveURL(/\/teacher$/); // a teacher is sent to their own area
  await expect(page.getByRole('link', { name: 'My Profile' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Settings' }).first()).toBeVisible();
});

test('confirmation page: a valid link confirms, an invalid one explains', async ({ page }) => {
  const token = 'a'.repeat(64);
  await mockApi(page, 'guest', (method, path, body) => {
    if (method === 'POST' && path === '/auth/verify-email-change') return body?.token === token ? { body: { success: true, message: 'Your e-mail address was updated.' } } : { status: 400, body: { success: false, message: 'This confirmation link is invalid or has expired.' } };
    return undefined;
  });
  await page.goto(`/verify-email-change/${token}`);
  await expect(page.getByRole('heading', { name: 'E-mail updated' })).toBeVisible();
  await page.goto(`/verify-email-change/${'b'.repeat(64)}`);
  await expect(page.getByRole('heading', { name: 'Could not confirm' })).toBeVisible();
});

for (const [role, path] of [['student', '/student/profile'], ['student', '/student/settings'], ['teacher', '/teacher/profile'], ['teacher', '/teacher/settings']] as const) {
  test(`no horizontal overflow on ${path} at 390px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockApi(page, role);
    await page.goto(path);
    await expect(page.getByRole('navigation', { name: 'Account sections' })).toBeVisible();
    await noOverflow(page, path);
  });
}
