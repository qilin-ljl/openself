import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
test.describe.configure({ mode: 'serial' });
test('AI review produces a finding that can be accepted and added to a draft', async ({ page }) => {
  test.setTimeout(90000);
  await page.request.post('/api/auth/test');
  await page.goto('/zh/r/tester/sandbox/pull/3');
  await page.getByRole('button', { name: '开始预审', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Handle whitespace-only input' })).toBeVisible({
    timeout: 60000,
  });
  await page.getByRole('button', { name: '接受', exact: true }).click();
  await page.getByRole('button', { name: '将已接受意见加入草稿' }).click();
  await expect(page.getByRole('heading', { name: '1 条行内评论' })).toBeVisible();
  await expect(page.locator('.pending-comments')).toContainText('Whitespace-only input');
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/ai-review-desktop.png', fullPage: true });
});
test('Issue assistant fills a form and exposes writing quality feedback', async ({ page }) => {
  test.setTimeout(90000);
  await page.request.post('/api/auth/test');
  await page.goto('/zh/r/tester/sandbox/issues/new');
  await page.getByLabel('Issue 模板').selectOption('bug.yml');
  await page.getByLabel('描述你遇到的问题').fill('Version 1.0 crashes when the input is empty.');
  await page.getByRole('button', { name: 'AI 起草', exact: true }).click();
  await expect(page.getByRole('button', { name: '填入编辑器' })).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: '填入编辑器' }).click();
  await expect(page.getByLabel('标题', { exact: true })).toHaveValue(
    'AI draft: empty input crashes',
  );
  await expect(page.getByLabel('Version', { exact: false })).toHaveValue('1.0');
  await page.getByRole('button', { name: '检查质量', exact: true }).click();
  await expect(page.getByRole('heading', { name: '质量评分：80/100' })).toBeVisible({
    timeout: 30000,
  });
});

test('unknown AI jobs return a safe not-found error across server bundles', async ({ page }) => {
  await page.request.post('/api/auth/test');
  const result = await page.request.get('/api/jobs/11111111-1111-4111-8111-111111111111');
  expect(result.status()).toBe(404);
  expect(await result.json()).toEqual({ error: { code: 'not_found', message: 'not_found' } });
});

test('users must save a personal key before using AI and removing it disables AI again', async ({
  page,
  baseURL,
}) => {
  await page.request.post('/api/auth/test');
  const headers = { Origin: new URL(baseURL!).origin };
  expect((await page.request.delete('/api/me/api-key', { headers })).ok()).toBe(true);
  await page.goto('/zh/settings');
  await expect(
    page.getByText('使用 AI 前请先配置自己的 API Key。', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '重新学习风格', exact: true })).toBeDisabled();
  const missing = await page.request.post('/api/translate', {
    headers,
    data: { text: 'Hello', to: 'zh' },
  });
  expect(missing.status()).toBe(409);
  expect((await missing.json()).error.code).toBe('llm_key_required');
  const input = page.getByLabel('自己的 DeepSeek API Key', { exact: false });
  await input.fill('test-personal-key-9876');
  await page
    .locator('.ai-settings')
    .getByRole('button', { name: '保存', exact: true })
    .first()
    .click();
  await expect(page.getByText('已保存，末四位：9876')).toBeVisible();
  await expect(input).toHaveValue('');
  await expect(page.getByRole('button', { name: '重新学习风格', exact: true })).toBeEnabled();
  const settings = await (await page.request.get('/api/me/ai')).json();
  expect(JSON.stringify(settings)).not.toContain('test-personal-key');
  const allowed = await page.request.post('/api/translate', {
    headers,
    data: { text: 'Hello', to: 'zh' },
  });
  expect(allowed.ok()).toBe(true);
  expect((await allowed.json()).jobId).toBeTruthy();
  await page.getByRole('button', { name: '删除 Key', exact: true }).click();
  await expect(
    page.getByText('使用 AI 前请先配置自己的 API Key。', { exact: false }),
  ).toBeVisible();
  const removed = await page.request.post('/api/translate', {
    headers,
    data: { text: 'Hello', to: 'zh' },
  });
  expect(removed.status()).toBe(409);
});
