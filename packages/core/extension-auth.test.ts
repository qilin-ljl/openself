import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import { schema, eq, type Database } from '@openself/db';
import {
  extensionOrigin,
  extensionRequestOrigin,
  validateExtensionRedirect,
  createExtensionAuth,
} from './extension-auth';
import { safeNext } from './auth-policy';
const id = 'a'.repeat(32),
  redirect = 'https://' + id + '.chromiumapp.org/',
  origin = 'chrome-extension://' + id;
const pg = new PGlite(),
  db = drizzle(pg, { schema }) as unknown as Database,
  service = createExtensionAuth(db, id);
beforeAll(async () => {
  await migrate(drizzle(pg), {
    migrationsFolder: fileURLToPath(new URL('../db/migrations', import.meta.url)),
  });
}, 30000);
beforeEach(async () => {
  await pg.exec('TRUNCATE users CASCADE');
});
afterAll(async () => pg.close());
it('allows only exact registered extension origins and redirect URLs', () => {
  expect(extensionOrigin(origin, id)).toBe(true);
  expect(extensionOrigin('https://evil.test', id)).toBe(false);
  expect(validateExtensionRedirect(redirect, id)).toBe(redirect);
  for (const url of [
    redirect + 'extra',
    'https://evil.test/',
    redirect + '?x=1',
    'https://' + id + '.chromiumapp.org.evil.test/',
  ])
    expect(() => validateExtensionRedirect(url, id)).toThrow();
});
it('preserves an encoded redirect parameter only inside a local app route', () => {
  const value = '/zh/extension/connect?redirect_uri=' + encodeURIComponent(redirect);
  expect(safeNext(value)).toBe(value);
  expect(safeNext('/%2f%2fevil.test')).toBe('/zh/dashboard');
});
it('exchanges a code once, binds its redirect and creates a distinct extension session', async () => {
  const [user] = await db.insert(schema.users).values({ githubId: 1, login: 'tester' }).returning();
  const code = await service.issue(user!.id, redirect);
  await expect(service.exchange(code, redirect, 'https://evil.test')).rejects.toThrow();
  const results = await Promise.allSettled([
    service.exchange(code, redirect, origin),
    service.exchange(code, redirect, origin),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const session = (await db.select().from(schema.sessions))[0];
  expect(session?.kind).toBe('extension');
  expect(session?.userId).toBe(user!.id);
});
it('rejects expired authorization codes', async () => {
  const [user] = await db.insert(schema.users).values({ githubId: 1, login: 'tester' }).returning();
  const code = await service.issue(user!.id, redirect);
  await db
    .update(schema.extensionAuthCodes)
    .set({ expiresAt: new Date(0) })
    .where(eq(schema.extensionAuthCodes.code, code));
  await expect(service.exchange(code, redirect, origin)).rejects.toMatchObject({
    code: 'invalid_auth_code',
  });
});
it('supports privileged extension requests without Origin but never overrides a website Origin', () => {
  expect(extensionRequestOrigin(null, id, id)).toBe(origin);
  expect(extensionRequestOrigin(null, 'b'.repeat(32), id)).toBeNull();
  expect(extensionOrigin(extensionRequestOrigin('https://evil.test', id, id), id)).toBe(false);
});
