import { test, expect } from '@playwright/test';
test('finds a project, scans evidence, prepares code and publishes a confirmed draft PR', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.request.post('/api/auth/test', { data: { account: 'contributions' } });
  await page.goto('/zh/contribute');
  await expect(page.getByRole('heading', { name: '想法找项目', exact: true })).toBeVisible();
  await page.getByLabel('描述你的想法', { exact: true }).fill('希望改善输入校验和空白字符处理');
  await page.getByRole('button', { name: '寻找项目', exact: true }).click();
  const project = page.locator('.project-match').filter({ hasText: 'tester/sandbox' });
  await expect(project).toBeVisible({ timeout: 30000 });
  await project.getByRole('link', { name: '体检这个仓库', exact: true }).click();
  await expect(page.getByRole('heading', { name: '仓库体检', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '开始体检', exact: true }).click();
  const finding = page.locator('.scan-finding').filter({ hasText: 'Handle whitespace-only input' });
  await expect(finding).toBeVisible({ timeout: 30000 });
  await expect(finding).toContainText('return value;');
  await finding.getByRole('button', { name: '准备代码改动', exact: true }).click();
  await expect(page.getByRole('heading', { name: '代码改动预览', exact: true })).toBeVisible();
  await expect(page.locator('.code-changes')).toContainText('|| null', { timeout: 30000 });
  await expect(page.getByText('未执行目标仓库的测试', { exact: true })).toBeVisible();
  await expect(page.getByLabel('以草稿 PR 创建', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: '保存 PR 草稿', exact: true }).click();
  await page.getByRole('link', { name: '查看草稿队列', exact: true }).click();
  const draft = page.locator('.draft-card').filter({
    has: page.getByRole('heading', { name: 'Guard whitespace-only input', exact: true }),
  });
  await draft.getByText('预览', { exact: true }).click();
  await expect(draft).toContainText('src/review.ts');
  page.once('dialog', (dialog) => dialog.accept());
  await draft.getByRole('button', { name: '批准并发布', exact: true }).click();
  await expect(draft.getByText('已发布', { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(draft.getByRole('link', { name: '在 GitHub 查看', exact: true })).toHaveAttribute(
    'href',
    'https://github.com/tester/sandbox/pull/99',
  );
});
