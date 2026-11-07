import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { NextRequest } from 'next/server';
import { schema, type Database } from '@openself/db';
import { databaseSessionStore } from '@openself/db/session-store';
import { createSessionService } from '@openself/core/session';
import { decrypt } from '@openself/core/crypto';
import { parseEnv } from '@openself/shared/env';
import { GET as login } from '../app/api/auth/github/login/route';
import { GET as callback } from '../app/api/auth/github/callback/route';
import { POST as logout } from '../app/api/auth/logout/route';
import { POST as revoke } from '../app/api/auth/revoke/route';
vi.mock('./runtime', () => ({ getRuntime: () => runtime }));
const env = parseEnv({
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://test:test@localhost/test',
  REDIS_URL: 'redis://localhost:6379',
  GITHUB_CLIENT_ID: 'test-client',
  GITHUB_CLIENT_SECRET: 'test-secret',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
});
const client = new PGlite();
const db = drizzle(client, { schema });
const runtime = {
  env,
  db,
  sessions: createSessionService(databaseSessionStore(db as unknown as Database)),
};
const server = setupServer(
  http.post('https://github.com/login/oauth/access_token', () =>
    HttpResponse.json({
      access_token: 'gho_test_only',
      token_type: 'bearer',
      scope: 'read:user,user:email,public_repo',
    }),
  ),
  http.get('https://api.github.com/user', () =>
    HttpResponse.json({
      id: 123,
      login: 'test-contributor',
      name: 'Test Contributor',
      avatar_url: 'https://avatars.githubusercontent.com/u/123',
    }),
  ),
  http.delete(
    'https://api.github.com/applications/test-client/grant',
    () => new HttpResponse(null, { status: 204 }),
  ),
);
beforeAll(async () => {
  server.listen({ onUnhandledFrame: 'error' });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)),
  });
}, 30000);
beforeEach(async () => {
  await client.exec('TRUNCATE users CASCADE');
});
afterEach(() => server.resetHandlers());
afterAll(async () => {
  server.close();
  await client.close();
});
const state = 'a'.repeat(32);
function callbackRequest() {
  return new NextRequest(
    `http://localhost:3000/api/auth/github/callback?code=one-use-code&state=${state}`,
    { headers: { cookie: `os_oauth_state=${state}; os_oauth_next=/en/dashboard` } },
  );
}
describe('GitHub OAuth route integration', () => {
  it('sets short-lived HttpOnly state and only requests public scopes', async () => {
    const response = await login(
      new NextRequest('http://localhost:3000/api/auth/github/login?next=https://evil.test'),
    );
    const url = new URL(response.headers.get('location')!);
    expect(url.origin).toBe('https://github.com');
    expect(url.searchParams.get('scope')?.split(' ')).toEqual([
      'read:user',
      'user:email',
      'public_repo',
    ]);
    expect(response.cookies.get('os_oauth_next')?.value).toBe('/zh/dashboard');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  });
  it('rejects missing or mismatched state before creating an identity', async () => {
    const response = await callback(
      new NextRequest('http://localhost:3000/api/auth/github/callback?code=unused&state=bad'),
    );
    expect(response.status).toBe(400);
    expect(await db.select().from(schema.users)).toHaveLength(0);
  });
  it('persists encrypted credentials, creates a real session and rotates it on re-login', async () => {
    const response = await callback(callbackRequest());
    expect(response.headers.get('location')).toBe('http://localhost:3000/en/dashboard');
    const sessionId = response.cookies.get('os_session')?.value;
    expect(sessionId).toBeTruthy();
    const session = await runtime.sessions.validate(sessionId);
    expect(session).not.toBeNull();
    const [token] = await db.select().from(schema.oauthTokens);
    expect(token?.accessTokenEnc).not.toContain('gho_test_only');
    expect(decrypt(token!.accessTokenEnc, env.ENCRYPTION_KEY)).toBe('gho_test_only');
    const second = callbackRequest();
    second.cookies.set('os_session', sessionId!);
    const secondResponse = await callback(second);
    expect(secondResponse.cookies.get('os_session')?.value).not.toBe(sessionId);
    expect(await runtime.sessions.validate(sessionId)).toBeNull();
    expect(await db.select().from(schema.users)).toHaveLength(1);
  });
  it('does not create a session when GitHub rejects the code', async () => {
    server.use(
      http.post('https://github.com/login/oauth/access_token', () =>
        HttpResponse.json({ error: 'bad_verification_code' }, { status: 400 }),
      ),
    );
    const response = await callback(callbackRequest());
    expect(response.headers.get('location')).toContain('error=oauth_failed');
    expect(await db.select().from(schema.sessions)).toHaveLength(0);
  });
  it('requires the same origin to log out and invalidates the stored session', async () => {
    const response = await callback(callbackRequest());
    const token = response.cookies.get('os_session')!.value;
    const foreign = await logout(
      new NextRequest('http://localhost:3000/api/auth/logout', {
        method: 'POST',
        headers: { origin: 'https://evil.test', cookie: `os_session=${token}` },
      }),
    );
    expect(foreign.status).toBe(403);
    expect(await runtime.sessions.validate(token)).not.toBeNull();
    const result = await logout(
      new NextRequest('http://localhost:3000/api/auth/logout', {
        method: 'POST',
        headers: { origin: env.APP_URL, cookie: `os_session=${token}` },
      }),
    );
    expect(result.status).toBe(200);
    expect(await runtime.sessions.validate(token)).toBeNull();
  });
  it('revokes remote access and deletes local credentials and sessions', async () => {
    const response = await callback(callbackRequest());
    const token = response.cookies.get('os_session')!.value;
    const result = await revoke(
      new NextRequest('http://localhost:3000/api/auth/revoke', {
        method: 'POST',
        headers: { origin: env.APP_URL, cookie: `os_session=${token}` },
      }),
    );
    expect(result.status).toBe(200);
    expect(await db.select().from(schema.oauthTokens)).toHaveLength(0);
    expect(await db.select().from(schema.sessions)).toHaveLength(0);
    expect(await db.select().from(schema.users)).toHaveLength(1);
  });
});
