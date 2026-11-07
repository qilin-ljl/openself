import { afterEach, expect, it, vi } from 'vitest';
import { POST } from '../app/api/auth/test/route';
afterEach(() => vi.unstubAllEnvs());
it('returns 404 in production even when the test-login flag is enabled', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('E2E_FAKE_AUTH', '1');
  expect((await POST()).status).toBe(404);
});
it('returns 404 without an explicit test flag in development', async () => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('E2E_FAKE_AUTH', '');
  expect((await POST()).status).toBe(404);
});
