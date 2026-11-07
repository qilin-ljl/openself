import { test, expect } from '@playwright/test';
test('landing page switches languages and preserves real login destination', async ({ page }) => {
  await page.goto('/zh');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('让每一次贡献');
  await expect(page.getByRole('link', { name: '用 GitHub 登录' }).last()).toHaveAttribute(
    'href',
    '/api/auth/github/login?next=/zh/dashboard',
  );
  await page.getByRole('link', { name: 'English' }).click();
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Make every');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    view: window.innerWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.view);
});
test('anonymous users cannot access the dashboard or account API', async ({ page, request }) => {
  await page.goto('/en/dashboard');
  await expect(page).toHaveURL(/\/en$/);
  const response = await request.get('/api/me');
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({
    error: { code: 'unauthorized', message: 'unauthorized' },
  });
});
test('invalid OAuth callback state never creates a session', async ({ request }) => {
  const response = await request.get('/api/auth/github/callback?state=bad&code=unused');
  expect(response.status()).toBe(400);
  expect(response.headers()['set-cookie'] ?? '').not.toMatch(/os_session=[^;]/);
});
