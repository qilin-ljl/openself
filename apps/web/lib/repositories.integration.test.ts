import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { NextRequest } from 'next/server';
import { eq, schema, type Database } from '@openself/db';
import { databaseSessionStore } from '@openself/db/session-store';
import { createSessionService } from '@openself/core/session';
import { createWorkspace } from '@openself/core/workspace';
import { encrypt } from '@openself/core/crypto';
import { parseEnv } from '@openself/shared/env';
import { GET } from '../app/api/[...path]/route';

vi.mock('./runtime', () => ({ getRuntime: () => runtime }));
vi.mock('./workspace', () => ({ getWorkspace: () => workspace }));
const env = parseEnv({
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://test:test@localhost/test',
  REDIS_URL: 'redis://localhost',
  GITHUB_CLIENT_ID: 'test-client',
  GITHUB_CLIENT_SECRET: 'test-secret',
  ENCRYPTION_KEY: Buffer.alloc(32, 6).toString('base64'),
});
const pg = new PGlite(),
  db = drizzle(pg, { schema }) as unknown as Database;
const runtime = { env, db, sessions: createSessionService(databaseSessionStore(db)) };
const workspace = createWorkspace(db, env, {
  cache: {
    async get() {
      return null;
    },
    async set() {},
  },
  enqueue: async () => {},
});
const repositories = [
  { id: 1, name: 'tools', full_name: 'Alice/tools', owner: { login: 'Alice' }, private: false },
  { id: 2, name: 'private', full_name: 'Alice/private', owner: { login: 'Alice' }, private: true },
  { id: 3, name: 'shared', full_name: 'bob/shared', owner: { login: 'bob' }, private: false },
].map((repo) => ({
  ...repo,
  description: 'Repository description',
  language: 'TypeScript',
  archived: false,
  updated_at: '2026-11-07T00:00:00Z',
  html_url: 'https://github.com/' + repo.full_name,
  permissions: { admin: true, push: true, pull: true },
}));
const server = setupServer(
  http.get('https://api.github.com/user/repos', ({ request }) => {
    expect(new URL(request.url).searchParams.get('affiliation')).toBe('owner');
    return HttpResponse.json(repositories);
  }),
);
let sessionId: string;
beforeAll(async () => {
  server.listen({ onUnhandledFrame: 'error' });
  await migrate(drizzle(pg), {
    migrationsFolder: fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)),
  });
}, 30000);
beforeEach(async () => {
  await pg.exec('TRUNCATE users CASCADE');
  const [user] = await db.insert(schema.users).values({ githubId: 1, login: 'alice' }).returning();
  await db.insert(schema.oauthTokens).values({
    userId: user!.id,
    accessTokenEnc: encrypt('fixture-token', env.ENCRYPTION_KEY),
    scopes: 'public_repo',
  });
  sessionId = (await runtime.sessions.create(user!.id)).id;
});
afterAll(async () => {
  server.close();
  await pg.close();
});
function list(authenticated = true) {
  return GET(
    new NextRequest('http://localhost:3000/api/me/repos?owner=bob', {
      headers: authenticated ? { cookie: 'os_session=' + sessionId } : {},
    }),
    { params: Promise.resolve({ path: ['me', 'repos'] }) },
  );
}
it('only returns the signed-in owner public repositories and selected display fields', async () => {
  const response = await list();
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.items).toEqual([
    {
      id: 1,
      fullName: 'Alice/tools',
      description: 'Repository description',
      language: 'TypeScript',
      private: false,
      archived: false,
      updatedAt: '2026-11-07T00:00:00Z',
    },
  ]);
});
it('includes private repositories only after private access is enabled', async () => {
  await db
    .update(schema.users)
    .set({ privateRepoEnabled: true })
    .where(eq(schema.users.login, 'alice'));
  const response = await list();
  expect(response.status).toBe(200);
  expect((await response.json()).items.map((repo: { fullName: string }) => repo.fullName)).toEqual([
    'Alice/tools',
    'Alice/private',
  ]);
});
it('requires sign-in before listing owned repositories', async () => {
  expect((await list(false)).status).toBe(401);
});
