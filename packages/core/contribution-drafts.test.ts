import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { schema, type Database } from '@openself/db';
import { parseEnv } from '@openself/shared/env';
import type { GitHubClient } from '@openself/github';
import { AppError } from '@openself/shared/errors';
import { createDraftService, draftDTO } from './drafts';
const pg = new PGlite(),
  db = drizzle(pg, { schema }) as unknown as Database;
const sha = 'a'.repeat(40),
  blob = 'b'.repeat(40),
  tree = 'c'.repeat(40),
  commit = 'd'.repeat(40);
let writes = 0,
  prWrites = 0,
  ref: string | null = null,
  failPR = false;
const env = parseEnv({
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://a:b@localhost/db',
  REDIS_URL: 'redis://localhost',
  GITHUB_CLIENT_ID: 'test',
  GITHUB_CLIENT_SECRET: 'test',
  ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
});
const github = {
  getRepo: async () => ({
    id: 1,
    private: false,
    archived: false,
    default_branch: 'main',
    permissions: { push: true },
  }),
  getBranchSha: async () => sha,
  getGitCommit: async () => ({ tree: { sha: tree } }),
  getGitTree: async () => ({
    truncated: false,
    tree: [{ path: 'src.ts', sha: blob, type: 'blob', mode: '100644' }],
  }),
  getViewer: async () => ({ id: 1, login: 'alice' }),
  getGitRef: async () => {
    if (!ref) throw new AppError('not_found', 404);
    return { object: { sha: ref } };
  },
  createGitRef: async () => {
    writes++;
    ref = sha;
    return { object: { sha } };
  },
  createGitBlob: async () => {
    writes++;
    return blob;
  },
  createGitTree: async () => {
    writes++;
    return tree;
  },
  createGitCommit: async () => {
    writes++;
    return commit;
  },
  updateGitRef: async () => {
    writes++;
    ref = commit;
    return { object: { sha: commit } };
  },
  createPullRequest: async () => {
    writes++;
    prWrites++;
    if (failPR) throw new AppError('unknown', 502);
    return { number: 7, url: 'https://github.com/o/r/pull/7' };
  },
} as unknown as GitHubClient;
const service = createDraftService({
  db,
  env,
  githubFor: async () => github,
  enqueue: async () => {},
});
beforeAll(async () => {
  await migrate(drizzle(pg), {
    migrationsFolder: fileURLToPath(new URL('../db/migrations', import.meta.url)),
  });
}, 30000);
beforeEach(async () => {
  await pg.exec('TRUNCATE users CASCADE');
  writes = 0;
  prWrites = 0;
  ref = null;
  failPR = false;
});
afterAll(() => pg.close());
async function setup() {
  const [user] = await db.insert(schema.users).values({ githubId: 1, login: 'alice' }).returning();
  const [job] = await db
    .insert(schema.aiJobs)
    .values({
      userId: user!.id,
      kind: 'change.prepare',
      status: 'done',
      payloadJson: {},
      resultJson: {
        repo: 'o/r',
        repoId: 1,
        baseBranch: 'main',
        baseSha: sha,
        scanJobId: '11111111-1111-4111-8111-111111111111',
        findingId: '22222222-2222-4222-8222-222222222222',
        title: 'Guard input',
        body: 'A source-grounded change.',
        verification: ['Run tests'],
        testsExecuted: false,
        files: [
          {
            path: 'src.ts',
            action: 'edit',
            before: 'return x.value;',
            after: 'return x?.value;',
            blobSha: blob,
            mode: '100644',
          },
        ],
      },
    })
    .returning();
  return {
    user: user!,
    input: { kind: 'pull_request', repo: 'o/r', payload: { changeJobId: job!.id, asDraft: true } },
  };
}
it('uses the owned prepared result rather than client-supplied code and requires approval', async () => {
  const { user, input } = await setup();
  const draft = await service.create(user, {
    ...input,
    payload: {
      ...input.payload,
      files: [{ path: '.github/workflows/evil.yml', after: 'unapproved' }],
    },
  });
  const dto = draftDTO(draft);
  expect(dto.kind).toBe('pull_request');
  if (dto.kind !== 'pull_request') throw new Error('Expected PR draft');
  expect(dto.payloadJson.files[0]?.path).toBe('src.ts');
  await service.publish(draft.id);
  expect(writes).toBe(0);
  await service.approve(user.id, draft.id);
  await Promise.all([service.publish(draft.id), service.publish(draft.id)]);
  expect(prWrites).toBe(1);
  expect((await service.find(user.id, draft.id)).status).toBe('published');
  expect((await service.audit(user.id))[0]?.action).toBe('pull_request.create');
});
it('cannot use another account prepared code job', async () => {
  const { input } = await setup();
  const [other] = await db.insert(schema.users).values({ githubId: 2, login: 'bob' }).returning();
  await expect(service.create(other!, input)).rejects.toMatchObject({ code: 'not_found' });
  expect(await db.select().from(schema.drafts)).toHaveLength(0);
});
it('locks a partially executed PR publication instead of issuing duplicate mutations', async () => {
  const { user, input } = await setup(),
    draft = await service.create(user, input);
  failPR = true;
  await service.approve(user.id, draft.id);
  await service.publish(draft.id);
  const count = writes;
  await service.publish(draft.id);
  expect(writes).toBe(count);
  expect(prWrites).toBe(1);
  expect(await service.find(user.id, draft.id)).toMatchObject({
    status: 'publishing',
    error: 'publication_unknown',
  });
});
