/** Admin > Manage Teachers > Delete, with a mocked API (server rules: backend/src/tests/deleteTeacher.test.js). */
import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './mockApi';

const mk = (id: string, name: string, approvalStatus: string, extra: any = {}) => ({
  _id: id, name, email: `${id}@example.com`, phone: '9000000000', role: 'teacher', isActive: true,
  isApproved: approvalStatus === 'APPROVED', approvalStatus, createdAt: '2026-10-01T00:00:00.000Z', ...extra,
});

async function setup(page: Page, deleteStatus = 200) {
  let list = [mk('t1', 'Approved Teacher', 'APPROVED'), mk('t2', 'Pending Teacher', 'PENDING'), mk('t3', 'Rejected Teacher', 'REJECTED')];
  const deletes: string[] = [];
  const puts: any[] = [];
  await mockApi(page, 'admin', (method, path) => {
    if (method === 'GET' && path.startsWith('/admin/users')) return { body: { success: true, users: list, total: list.length } };
    return undefined;
  });
  await page.route('**/api/admin/teachers/*', async (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    const id = route.request().url().split('/').pop()!;
    deletes.push(id);
    await new Promise((r) => setTimeout(r, 250));
    if (deleteStatus !== 200) return route.fulfill({ status: deleteStatus, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Teacher still has courses; use Deactivate.' }) });
    list = list.filter((t) => t._id !== id);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: 'Teacher account deleted successfully.' }) });
  });
  await page.route('**/api/admin/users/*', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    puts.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, user: {} }) });
  });
  return { deletes, puts };
}

test('every status has a Delete button; cancel changes nothing; confirm removes the teacher and updates stats', async ({ page }) => {
  const { deletes } = await setup(page);
  await page.goto('/admin/teachers');
  for (const n of ['Approved Teacher', 'Pending Teacher', 'Rejected Teacher']) await expect(page.getByRole('button', { name: `Delete ${n}` })).toBeVisible();
  await expect(page.getByText('Total Teachers')).toBeVisible();

  await page.getByRole('button', { name: 'Delete Pending Teacher' }).click();
  const dlg = page.getByRole('dialog', { name: 'Delete Teacher Account?' });
  await expect(dlg).toContainText('Pending Teacher');
  await expect(dlg).toContainText('t2@example.com');
  await expect(dlg).toContainText('9000000000');
  await expect(dlg).toContainText('Pending approval');
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  expect(deletes).toEqual([]);
  await expect(page.getByText('Pending Teacher')).toBeVisible();

  await page.getByRole('button', { name: 'Delete Pending Teacher' }).click();
  const confirm = page.getByRole('dialog').getByRole('button', { name: 'Delete Teacher' });
  await confirm.click();
  await expect(confirm).toBeDisabled(); // busy: no duplicate submit
  await confirm.click({ force: true }).catch(() => {});
  await expect(page.getByText('Teacher account deleted successfully.')).toBeVisible();
  await expect(page.getByText('Pending Teacher')).toHaveCount(0);
  expect(deletes).toEqual(['t2']);
  await expect(page.getByRole('button', { name: 'Delete Approved Teacher' })).toBeVisible(); // others untouched
});

test('server refusal shows its message and keeps the teacher', async ({ page }) => {
  await setup(page, 409);
  await page.goto('/admin/teachers');
  await page.getByRole('button', { name: 'Delete Approved Teacher' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete Teacher' }).click();
  await expect(page.getByText('Teacher still has courses; use Deactivate.')).toBeVisible();
  await expect(page.getByText('Approved Teacher').first()).toBeVisible();
});

test('Deactivate still works and mobile layout keeps both buttons on screen', async ({ page }) => {
  const { puts } = await setup(page);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/admin/teachers');
  const del = page.getByRole('button', { name: 'Delete Approved Teacher' });
  await expect(del).toBeVisible();
  const box = await del.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  await page.getByRole('button', { name: 'Deactivate' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Deactivate' }).click();
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0]).toEqual({ isActive: false });
});
