import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { schema, type Database } from '@openself/db';
import { parseEnv } from '@openself/shared/env';
import { createGitHubClient } from '@openself/github';
import { createDraftService } from './drafts';
const pg = new PGlite(),
  db = drizzle(pg, { schema }) as unknown as Database;
const sha = 'a'.repeat(40);
let head = sha,
  author = 'other',
  writes = 0;
let posted: Record<string, unknown> = {};
const env = parseEnv({
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://a:b@localhost/db',
  REDIS_URL: 'redis://localhost:6379',
  GITHUB_CLIENT_ID: 'test',
  GITHUB_CLIENT_SECRET: 'test',
  ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  DEV_TEST_REPO: 'tester/sandbox',
});
const service = createDraftService({
  db,
  env,
  githubFor: async (userId) => createGitHubClient('test-token', { userId }),
  enqueue: async () => {},
});
const server = setupServer(
  http.get('https://api.github.com/repos/:owner/:repo', () =>
    HttpResponse.json({ private: false, archived: false, has_issues: true }),
  ),
  http.get('https://api.github.com/repos/:owner/:repo/pulls/3', () =>
    HttpResponse.json({
      number: 3,
      title: 'Fix empty values',
      head: { sha: head },
      user: { login: author },
      state: 'open',
    }),
  ),
  http.get('https://api.github.com/repos/:owner/:repo/pulls/3/files', () =>
    HttpResponse.json([
      { filename: 'src.ts', patch: '@@ -1,3 +1,3 @@\n context\n-old\n+new\n end' },
    ]),
  ),
  http.post(
    'https://api.github.com/repos/:owner/:repo/pulls/3/reviews',
    async ({ request, params }) => {
      writes++;
      posted = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json(
        {
          id: 44,
          html_url:
            'https://github.com/' +
            params.owner +
            '/' +
            params.repo +
            '/pull/3#pullrequestreview-44',
        },
        { status: 200 },
      );
    },
  ),
);
beforeAll(async () => {
  server.listen({ onUnhandledFrame: 'error' });
  await migrate(drizzle(pg), {
    migrationsFolder: fileURLToPath(new URL('../db/migrations', import.meta.url)),
  });
}, 30000);
beforeEach(async () => {
  await pg.exec('TRUNCATE users CASCADE');
  head = sha;
  author = 'other';
  writes = 0;
  posted = {};
});
afterAll(async () => {
  server.close();
  await pg.close();
});
async function user() {
  return (await db.insert(schema.users).values({ githubId: 42, login: 'tester' }).returning())[0]!;
}
const input = {
  kind: 'review',
  repo: 'tester/sandbox',
  prNumber: 3,
  payload: {
    headSha: sha,
    event: 'COMMENT',
    body: 'Review summary',
    comments: [
      { path: 'src.ts', line: 1, side: 'RIGHT', body: 'Context comment' },
      { path: 'src.ts', line: 2, side: 'LEFT', body: 'Deletion comment' },
      { path: 'src.ts', line: 2, side: 'RIGHT', body: 'Addition comment' },
    ],
  },
};
it('publishes all three comments as one review at the reviewed SHA', async () => {
  const u = await user(),
    d = await service.create(u, input);
  await service.approve(u.id, d.id);
  await service.publish(d.id);
  expect(writes).toBe(1);
  expect(posted).toMatchObject({
    commit_id: sha,
    event: 'COMMENT',
    comments: input.payload.comments,
  });
  expect((await service.find(u.id, d.id)).status).toBe('published');
  expect((await service.audit(u.id))[0]?.action).toBe('review.submit');
});
it('publishes a reviewed pull request in another owner repository during local use', async () => {
  const u = await user(),
    d = await service.create(u, { ...input, repo: 'other/project' });
  await service.publish(d.id);
  expect(writes).toBe(0);
  await service.approve(u.id, d.id);
  await service.publish(d.id);
  expect(writes).toBe(1);
  expect(posted).toMatchObject({
    commit_id: sha,
    event: 'COMMENT',
    comments: input.payload.comments,
  });
  expect(await service.find(u.id, d.id)).toMatchObject({
    status: 'published',
    githubUrl: 'https://github.com/other/project/pull/3#pullrequestreview-44',
  });
});
it('blocks publication when the head changes after drafting', async () => {
  const u = await user(),
    d = await service.create(u, input);
  head = 'b'.repeat(40);
  await service.approve(u.id, d.id);
  await service.publish(d.id);
  expect(writes).toBe(0);
  expect(await service.find(u.id, d.id)).toMatchObject({ status: 'failed', error: 'stale_head' });
});
it('rejects self-approval and self-request-changes on the server', async () => {
  author = 'tester';
  const u = await user();
  for (const event of ['APPROVE', 'REQUEST_CHANGES'])
    await expect(
      service.create(u, { ...input, payload: { ...input.payload, event } }),
    ).rejects.toMatchObject({ code: 'self_review' });
  expect(writes).toBe(0);
});
it('keeps invalid-line comments visible in the summary', async () => {
  const u = await user(),
    d = await service.create(u, {
      ...input,
      payload: {
        ...input.payload,
        comments: [
          { path: 'src.ts', line: 99, side: 'RIGHT', body: 'An out-of-range observation' },
        ],
      },
    });
  expect((d.payloadJson as { body: string }).body).toContain('src.ts:99');
  await service.approve(u.id, d.id);
  await service.publish(d.id);
  expect(posted.comments).toEqual([]);
  expect(posted.body).toContain('An out-of-range observation');
});
