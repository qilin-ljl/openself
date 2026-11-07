import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
test('searches a repo, completes a template, saves and approves one issue', async ({ page }) => {
  await page.request.post('/api/auth/test');
  await page.goto('/zh/search');
  await page.getByRole('textbox', { name: '搜索', exact: true }).fill('sandbox');
  await page.getByRole('link', { name: 'tester/sandbox' }).click();
  await expect(page.getByRole('heading', { name: 'sandbox', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '起草 Issue' }).click();
  await page.getByLabel('Issue 模板').selectOption('bug.yml');
  await page.getByLabel('标题', { exact: true }).fill('E2E: report reproducible crash');
  await page.getByLabel('Version', { exact: false }).fill('1.0');
  await page
    .getByLabel('Steps to reproduce', { exact: false })
    .fill('Open the test app and click Run.');
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/issue-editor-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await page.getByRole('link', { name: /草稿已保存/ }).click();
  const draft = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'E2E: report reproducible crash' }) });
  await expect(draft).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await draft.getByRole('button', { name: '批准并发布' }).click();
  await expect(draft.getByText('已发布', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(draft.getByRole('link', { name: '在 GitHub 查看' })).toHaveAttribute(
    'href',
    /github.com\/tester\/sandbox\/issues\/\d+/,
  );
  await page.getByRole('link', { name: '发布记录', exact: true }).click();
  await expect(page.locator('.discussion-row').filter({ hasText: 'Issue' })).toHaveCount(1);
});
