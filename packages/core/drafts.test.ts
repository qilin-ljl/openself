import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, afterAll, afterEach, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { schema, eq, type Database } from '@openself/db';
import { parseEnv } from '@openself/shared/env';
import { createGitHubClient } from '@openself/github';
import { createDraftService } from './drafts';
const pg = new PGlite();
const db = drizzle(pg, { schema }) as unknown as Database;
const env = parseEnv({
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://a:b@localhost/db',
  REDIS_URL: 'redis://localhost:6379',
  GITHUB_CLIENT_ID: 'test',
  GITHUB_CLIENT_SECRET: 'test',
  ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  DEV_TEST_REPO: 'tester/sandbox',
});
let writes = 0;
let posted: unknown;
let postedTarget = '';
const service = createDraftService({
  db,
  env,
  githubFor: async (userId) => createGitHubClient('test-token', { userId }),
  enqueue: async () => {},
});
const server = setupServer(
  http.get('https://api.github.com/repos/:owner/:repo', () =>
    HttpResponse.json({
      private: false,
      archived: false,
      has_issues: true,
      permissions: { push: false },
    }),
  ),
  http.get(
    'https://api.github.com/repos/:owner/:repo/contents/.github%2FISSUE_TEMPLATE',
    () => new HttpResponse(null, { status: 404 }),
  ),
  http.post('https://api.github.com/repos/:owner/:repo/issues', async ({ request, params }) => {
    writes++;
    posted = await request.json();
    postedTarget = params.owner + '/' + params.repo;
    return HttpResponse.json(
      { number: 17, html_url: 'https://github.com/' + postedTarget + '/issues/17' },
      { status: 201 },
    );
  }),
);
beforeAll(async () => {
  server.listen({ onUnhandledFrame: 'error' });
  await migrate(drizzle(pg), {
    migrationsFolder: fileURLToPath(new URL('../db/migrations', import.meta.url)),
  });
}, 30000);
beforeEach(async () => {
  await pg.exec('TRUNCATE users CASCADE');
  writes = 0;
  posted = undefined;
  postedTarget = '';
});
afterEach(() => server.resetHandlers());
afterAll(async () => {
  server.close();
  await pg.close();
});
async function user(githubId = 1) {
  return (await db.insert(schema.users).values({ githubId, login: 'tester' }).returning())[0]!;
}
const input = {
  kind: 'issue',
  repo: 'tester/sandbox',
  payload: { title: 'Reproduce crash', body: 'Steps to reproduce', lang: 'en', labels: ['admin'] },
};
it('keeps drafts private to their creator', async () => {
  const a = await user(),
    b = await user(2);
  const draft = await service.create(a, input);
  await expect(service.find(b.id, draft.id)).rejects.toMatchObject({ code: 'not_found' });
  await expect(service.approve(b.id, draft.id)).rejects.toMatchObject({ code: 'not_found' });
  expect(await service.list(b.id)).toHaveLength(0);
});
it('publishes only once after repeated approval and duplicate job delivery', async () => {
  const a = await user();
  const d = await service.create(a, input);
  await service.publish(d.id);
  expect(writes).toBe(0);
  await Promise.all([service.approve(a.id, d.id), service.approve(a.id, d.id)]);
  await Promise.all([service.publish(d.id), service.publish(d.id)]);
  expect(writes).toBe(1);
  expect((await service.find(a.id, d.id)).status).toBe('published');
  expect(await service.audit(a.id)).toHaveLength(1);
  expect(posted).toMatchObject({ title: 'Reproduce crash', labels: [] });
  expect((posted as { body: string }).body).not.toContain('AI');
});
it('publishes to another owner repository locally only after explicit approval', async () => {
  const a = await user();
  const d = await service.create(a, { ...input, repo: 'other/project' });
  await service.publish(d.id);
  expect(writes).toBe(0);
  await service.approve(a.id, d.id);
  await service.publish(d.id);
  expect(writes).toBe(1);
  expect(postedTarget).toBe('other/project');
  expect(await service.find(a.id, d.id)).toMatchObject({
    status: 'published',
    githubUrl: 'https://github.com/other/project/issues/17',
  });
  await expect(service.update(a, d.id, input.payload)).rejects.toMatchObject({
    code: 'draft_locked',
  });
});
it('never blindly retries an ambiguous GitHub response', async () => {
  server.use(
    http.post('https://api.github.com/repos/:owner/:repo/issues', () => {
      writes++;
      return new HttpResponse(null, { status: 502 });
    }),
  );
  const a = await user(),
    d = await service.create(a, input);
  await service.approve(a.id, d.id);
  await service.publish(d.id);
  await service.publish(d.id);
  expect(writes).toBe(1);
  expect(await service.find(a.id, d.id)).toMatchObject({
    status: 'publishing',
    error: 'publication_unknown',
  });
  await expect(service.update(a, d.id, input.payload)).rejects.toMatchObject({
    code: 'draft_locked',
  });
});
it('retains a rejected draft for correction after a definite 422 response', async () => {
  server.use(
    http.post(
      'https://api.github.com/repos/:owner/:repo/issues',
      () => new HttpResponse(null, { status: 422 }),
    ),
  );
  const a = await user(),
    d = await service.create(a, input);
  await service.approve(a.id, d.id);
  await service.publish(d.id);
  expect(await service.find(a.id, d.id)).toMatchObject({ status: 'failed', error: 'validation' });
  expect((await service.update(a, d.id, input.payload)).status).toBe('draft');
});
it('reserves publication limits inside a transaction: five per repo per Beijing day', async () => {
  const a = await user();
  for (let i = 0; i < 6; i++) {
    const d = await service.create(a, input);
    await service.approve(a.id, d.id);
    await service.publish(d.id);
    if (i === 5)
      expect(await service.find(a.id, d.id)).toMatchObject({
        status: 'approved',
        error: 'rate_limited',
      });
  }
  expect(writes).toBe(5);
}, 30000);
it('enforces the ten-per-hour user limit across repositories', async () => {
  const a = await user();
  await db.insert(schema.drafts).values(
    Array.from({ length: 10 }, (_, i) => ({
      userId: a.id,
      kind: 'issue' as const,
      repoFullName: 'tester/other-' + i,
      status: 'published' as const,
      payloadJson: input.payload,
      idempotencyKey: 'past-' + i,
    })),
  );
  const d = await service.create(a, input);
  await service.approve(a.id, d.id);
  await service.publish(d.id);
  expect(writes).toBe(0);
  expect((await service.find(a.id, d.id)).error).toBe('rate_limited');
});
it('does not mutate approved content when a template changes after saving', async () => {
  let value = 'Old label';
  server.use(
    http.get('https://api.github.com/repos/:owner/:repo/contents/.github%2FISSUE_TEMPLATE', () =>
      HttpResponse.json([
        { name: 'bug.yml', path: '.github/ISSUE_TEMPLATE/bug.yml', type: 'file' },
      ]),
    ),
    http.get(
      'https://api.github.com/repos/:owner/:repo/contents/.github%2FISSUE_TEMPLATE%2Fbug.yml',
      () =>
        HttpResponse.json({
          encoding: 'base64',
          content: Buffer.from(
            'name: Bug\nbody:\n  - type: input\n    id: detail\n    attributes:\n      label: ' +
              value,
          ).toString('base64'),
        }),
    ),
  );
  const a = await user();
  const d = await service.create(a, {
    ...input,
    payload: { ...input.payload, templateId: 'bug.yml', answers: { detail: 'My answer' } },
  });
  value = 'New label';
  await service.approve(a.id, d.id);
  await service.publish(d.id);
  expect(writes).toBe(0);
  expect((await service.find(a.id, d.id)).error).toBe('template_changed');
});
it('processes an approved outbox row outside the former development repository', async () => {
  const a = await user(),
    d = await service.create(a, { ...input, repo: 'other/project' });
  await db.update(schema.drafts).set({ status: 'approved' }).where(eq(schema.drafts.id, d.id));
  await service.publish(d.id);
  expect(writes).toBe(1);
  expect(postedTarget).toBe('other/project');
  expect((await service.find(a.id, d.id)).status).toBe('published');
});
it('keeps GitHub permission denials as failed drafts without retrying', async () => {
  server.use(
    http.post('https://api.github.com/repos/other/project/issues', () => {
      writes++;
      return HttpResponse.json({ message: 'Forbidden' }, { status: 403 });
    }),
  );
  const a = await user(),
    d = await service.create(a, { ...input, repo: 'other/project' });
  await service.approve(a.id, d.id);
  await service.publish(d.id);
  await service.publish(d.id);
  expect(writes).toBe(1);
  expect(await service.find(a.id, d.id)).toMatchObject({ status: 'failed', error: 'forbidden' });
});
