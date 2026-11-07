import { test, expect } from '@playwright/test';

test('opens owned repositories from the dashboard directly in the PR list', async ({ page }) => {
  await page.request.post('/api/auth/test');
  await page.goto('/zh/dashboard');
  const repositories = page.getByRole('region', { name: '我的仓库', exact: true });
  await expect(repositories).toBeVisible();
  await expect(repositories).not.toContainText('test-contributor/private-repo');
  await expect(repositories).not.toContainText('tester/sandbox');
  await repositories.getByRole('link', { name: /test-contributor\/playground/ }).click();
  await expect(page).toHaveURL(/\/zh\/r\/test-contributor\/playground\?tab=pulls$/);
  await expect(page.getByRole('tab', { name: 'Pull requests', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('link', { name: 'Handle empty review input', exact: true }).click();
  await expect(page).toHaveURL(/\/zh\/r\/test-contributor\/playground\/pull\/3$/);
  await expect(page.getByRole('button', { name: '开始预审', exact: true })).toBeVisible();
  await expect(page.locator('.diff-section')).toContainText('input.trim()');
});

test('repository shortcuts stay available when other dashboard requests fail', async ({ page }) => {
  await page.request.post('/api/auth/test');
  await page.route('**/api/dashboard', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'service_unavailable' } }),
    }),
  );
  await page.goto('/zh/dashboard');
  await expect(page.locator('.error-notice')).toContainText('服务暂时不可用');
  await expect(
    page
      .getByRole('region', { name: '我的仓库', exact: true })
      .getByRole('link', { name: /test-contributor\/playground/ }),
  ).toBeVisible();
});
