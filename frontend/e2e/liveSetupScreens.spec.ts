import { test, expect } from '@playwright/test';
import { mockApi } from './mockApi';
import { findOverflow } from './layout';

/** Teacher "Meeting setup" in the create dialog, and the admin Live Class Management dashboard, at phone widths (mocked API). */
for (const width of [320, 360, 430]) {
  test(`teacher create dialog shows meeting setup, sends meetingConfig, no overflow @${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 780 });
    let posted: any = null;
    await mockApi(page, 'teacher', (method, path, body) => { if (method === 'POST' && path === '/live-sessions') { posted = body; return { status: 201, body: { success: true, session: { _id: 'new1', title: 'Revision class', status: 'scheduled', sessionCode: 'NEW1', standard: 10, subject: 'Mathematics' } } }; } return undefined; });
    await page.goto('/teacher/live');
    await page.getByRole('button', { name: /Create Session/ }).first().click();
    const setup = page.getByTestId('meeting-setup');
    await expect(setup).toBeVisible();
    await setup.getByText('Students see the host only').click();
    expect((await findOverflow(page)).offenders).toEqual([]);
    await page.getByPlaceholder('e.g., Trigonometry Masterclass').fill('Revision class');
    await page.getByLabel('Create live session').getByRole('button', { name: 'Create Session' }).click();
    await expect.poll(() => posted).not.toBeNull();
    expect(posted.meetingConfig.mode).toBe('host_only');
    expect(posted.meetingConfig).not.toHaveProperty('configVersion');
    expect(posted.meetingConfig).not.toHaveProperty('selectedUserIds');
  });
}

test('admin Live Class Management lists classes with host, standard, mode and a console link', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await mockApi(page, 'admin');
  await page.goto('/admin/live');
  await expect(page.getByRole('heading', { name: 'Live Class Management' })).toBeVisible();
  const row = page.getByTestId('live-row-SCI10');
  await expect(row).toContainText('Nikhil Kandangire');
  await expect(row).toContainText('23 connected');
  await expect(row.getByRole('link', { name: /Open console/ })).toHaveAttribute('href', '/admin/live/SCI10');
  expect((await findOverflow(page)).offenders).toEqual([]);
});
