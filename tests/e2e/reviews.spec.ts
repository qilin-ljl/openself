import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
test('reads both diff modes, drafts three inline comments and publishes one review', async ({
  page,
}) => {
  await page.request.post('/api/auth/test');
  await page.goto('/zh/r/tester/sandbox/pull/3');
  await expect(page.getByRole('heading', { name: 'Handle empty review input' })).toBeVisible();
  await expect(page.locator('.diff-section')).toContainText('input.trim()');
  await page.getByRole('button', { name: '统一', exact: true }).click();
  await expect(page.locator('.diff-section')).toContainText('if (!input)');
  await page.getByRole('button', { name: '分栏', exact: true }).click();
  for (const [line, side, text] of [
    ['1', 'RIGHT', 'Check the input contract.'],
    ['2', 'LEFT', 'Preserve trimming behavior.'],
    ['3', 'RIGHT', 'Consider whitespace-only input.'],
  ]) {
    await page.getByLabel('行号', { exact: true }).fill(line!);
    await page.getByLabel('代码版本', { exact: true }).selectOption(side!);
    await page.getByLabel('审查意见', { exact: true }).fill(text!);
    await page.getByRole('button', { name: '添加行内评论', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: '3 条行内评论' })).toBeVisible();
  await expect(page.locator('.diff-section')).toContainText('Check the input contract.');
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/pr-review-desktop.png', fullPage: true });
  await page
    .getByRole('textbox', { name: '总评', exact: true })
    .fill('Please cover whitespace-only input as well.');
  await page.getByRole('button', { name: '生成审查草稿' }).click();
  await page.getByRole('link', { name: '查看草稿队列', exact: true }).click();
  const draft = page
    .locator('article.draft-card')
    .filter({ has: page.getByRole('heading', { name: 'Handle empty review input' }) });
  await draft.getByText('预览', { exact: true }).click();
  await expect(draft).toContainText('Consider whitespace-only input.');
  page.once('dialog', (dialog) => dialog.accept());
  await draft.getByRole('button', { name: '批准并发布' }).click();
  await expect(draft.getByText('已发布', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(draft.getByRole('link', { name: '在 GitHub 查看' })).toHaveAttribute(
    'href',
    /pullrequestreview-100/,
  );
});
