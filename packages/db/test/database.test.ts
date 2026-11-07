import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as schema from '../schema';
const client = new PGlite();
const db = drizzle(client, { schema });
beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
}, 30000);
afterAll(async () => {
  await client.close();
});
it('migrates an empty Postgres database and preserves unique GitHub identities', async () => {
  const [user] = await db
    .insert(schema.users)
    .values({ githubId: 42, login: 'migration-test' })
    .returning();
  expect(user).toMatchObject({ locale: 'zh', aiDisclosure: true, maxFindings: 10 });
  await expect(
    db.insert(schema.users).values({ githubId: 42, login: 'duplicate' }),
  ).rejects.toThrow();
});
it('rejects duplicate publication keys and invalid draft states', async () => {
  const [user] = await db
    .insert(schema.users)
    .values({ githubId: 43, login: 'draft-owner' })
    .returning();
  const draft = {
    userId: user!.id,
    kind: 'issue' as const,
    repoFullName: 'owner/test',
    payloadJson: { title: 'test' },
    idempotencyKey: 'unique-publication',
  };
  await db.insert(schema.drafts).values(draft);
  await expect(db.insert(schema.drafts).values(draft)).rejects.toThrow();
  await expect(client.query("update drafts set status='unexpected'")).rejects.toThrow();
});
