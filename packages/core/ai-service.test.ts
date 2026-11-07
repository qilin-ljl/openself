import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { schema, eq, type Database } from '@openself/db';
import { resolveProvider, type Billing } from './ai-billing';
import { z } from '@openself/shared/api';
import { parseEnv } from '@openself/shared/env';
import { createWorkspace } from './workspace';
import { createAIService } from './ai-service';
import { encrypt } from './crypto';
import { recordEdit } from './style-feedback';
import { recoverAIJobs } from './job-recovery';
const pg = new PGlite(),
  db = drizzle(pg, { schema }) as unknown as Database;
const env = {
  ...parseEnv({
    APP_URL: 'http://localhost:3000',
    DATABASE_URL: 'postgres://a:b@localhost/db',
    REDIS_URL: 'redis://localhost',
    GITHUB_CLIENT_ID: 'test',
    GITHUB_CLIENT_SECRET: 'test',
    ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  }),
  DEEPSEEK_API_KEY: 'test-platform',
};
const workspace = createWorkspace(db, env, {
  cache: {
    async get() {
      return null;
    },
    async set() {},
  },
  enqueue: async () => {},
});
const service = createAIService({ db, env, workspace, enqueue: async () => {} });
let head = 'a'.repeat(40),
  privateRepo = false,
  invalid = 0;
const server = setupServer(
  http.get('https://api.github.com/repos/o/r/readme', () =>
    HttpResponse.json({
      path: 'README.md',
      encoding: 'base64',
      content: Buffer.from('A TypeScript library.').toString('base64'),
    }),
  ),
  http.get('https://api.github.com/repos/o/r', () =>
    HttpResponse.json({ private: privateRepo, default_branch: 'main' }),
  ),
  http.get('https://api.github.com/repos/o/r/pulls/:n', () =>
    HttpResponse.json({ head: { sha: head }, title: 'Fix input', user: { login: 'author' } }),
  ),
  http.get('https://api.github.com/repos/o/r/pulls/:n/files', () =>
    HttpResponse.json([
      {
        filename: 'src/input.ts',
        additions: 3,
        deletions: 0,
        patch: '@@ -0,0 +1,3 @@\n+export function read(x) {\n+ return x.value;\n+}',
      },
    ]),
  ),
  http.get('https://api.github.com/repos/o/r/commits/main', () =>
    HttpResponse.json({ sha: 'b'.repeat(40) }),
  ),
  http.get('https://api.github.com/repos/o/r/pulls', () => HttpResponse.json([])),
  http.get(
    'https://api.github.com/repos/o/r/contents/:path',
    () => new HttpResponse(null, { status: 404 }),
  ),
  http.post('https://api.deepseek.com/chat/completions', async ({ request }) => {
    const body = (await request.json()) as { messages: { content: string }[] };
    const task = body.messages[0]!.content;
    let data: unknown;
    if (task.includes('[TASK:rulecard]'))
      data = {
        summary: 'No supplied conventions',
        naming: [],
        commitConvention: null,
        testing: [],
        topConcerns: [],
        doNot: [],
      };
    else if (task.includes('[TASK:riskScore]'))
      data = { files: [{ path: 'src/input.ts', score: 4, reasons: ['Unchecked input'] }] };
    else if (task.includes('[TASK:review]')) {
      data = {
        findings: [
          {
            path: 'src/input.ts',
            line: 2,
            side: 'RIGHT',
            severity: 'major',
            category: 'bug',
            title: 'Handle missing input',
            body: 'Null input throws before returning a value.',
            confidence: 0.9,
          },
          {
            path: 'missing.ts',
            line: 99,
            side: 'RIGHT',
            severity: 'major',
            category: 'bug',
            title: 'Invented path',
            body: 'Invalid coordinate',
            confidence: 0.9,
          },
        ],
      };
      if (invalid > 0) {
        invalid--;
        return answer('not json');
      }
    } else data = { items: [] };
    return answer(JSON.stringify(data));
  }),
);
function answer(content: string) {
  return HttpResponse.json({
    id: 'test',
    object: 'chat.completion',
    created: 1,
    model: 'test',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 20, completion_tokens: 10 },
  });
}
beforeAll(async () => {
  server.listen({ onUnhandledFrame: 'error' });
  await migrate(drizzle(pg), {
    migrationsFolder: fileURLToPath(new URL('../db/migrations', import.meta.url)),
  });
}, 30000);
beforeEach(async () => {
  await pg.exec('TRUNCATE users CASCADE; TRUNCATE repo_rulecards');
  head = 'a'.repeat(40);
  privateRepo = false;
  invalid = 0;
});
afterAll(async () => {
  server.close();
  await pg.close();
});
async function user(id = 1, withKey = true) {
  const [u] = await db.insert(schema.users).values({ githubId: id, login: 'tester' }).returning();
  await db.insert(schema.oauthTokens).values({
    userId: u!.id,
    accessTokenEnc: encrypt('test-token', env.ENCRYPTION_KEY),
    scopes: 'public_repo',
  });
  if (withKey) await service.setKey(u!.id, `test-user-${id}-key-1234`);
  return u!;
}
it('runs review, validates coordinates, records usage and reuses a reviewed head without another charge', async () => {
  const u = await user(),
    r = await service.startReview(u, { repo: 'o/r', prNumber: 3 });
  await service.run(r.jobId!);
  const jobRow = (await db.select().from(schema.aiJobs).where(eq(schema.aiJobs.id, r.jobId!)))[0]!;
  expect((jobRow.payloadJson as { lang: string }).lang).toBe('en');
  const result = await service.getReview(u.id, r.reviewSessionId);
  expect(result.status).toBe('done');
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]?.path).toBe('src/input.ts');
  expect(result.riskMapJson?.reviewedFiles).toBe(1);
  expect((await service.startReview(u, { repo: 'o/r', prNumber: 3 })).jobId).toBeNull();
  const settings = await service.settings(u.id);
  expect(settings.usage.find((row) => row.kind === 'own.review')?.count).toBe(1);
  expect(settings.usage[0]!.tokensIn).toBeGreaterThan(0);
  const job = (await service.getJob(u.id, r.jobId!)).resultJson as {
    usage: { input: number };
    durationMs: number;
  };
  expect(job.usage.input).toBeGreaterThan(0);
  expect(job.durationMs).toBeGreaterThan(0);
  expect(settings.statistics[0]?.reviews).toBe(1);
}, 30000);
it('rejects a stale head before calling the model', async () => {
  const u = await user(),
    r = await service.startReview(u, { repo: 'o/r', prNumber: 3 });
  head = 'c'.repeat(40);
  await expect(service.run(r.jobId!)).rejects.toMatchObject({ code: 'stale_head' });
  expect((await service.getReview(u.id, r.reviewSessionId)).status).toBe('failed');
});
it('recovers after one malformed LLM response and fails safely after two', async () => {
  const u = await user();
  await service.setKey(u.id, 'test-own-key-1234');
  invalid = 1;
  const a = await service.startReview(u, { repo: 'o/r', prNumber: 3 });
  await service.run(a.jobId!);
  expect((await service.getReview(u.id, a.reviewSessionId)).status).toBe('done');
  invalid = 2;
  const b = await service.startReview(u, { repo: 'o/r', prNumber: 4 });
  await expect(service.run(b.jobId!)).rejects.toMatchObject({ code: 'llm_output_invalid' });
  expect((await service.getJob(u.id, b.jobId!)).error).toBe('llm_output_invalid');
}, 30000);
it('serializes duplicate review requests and keeps results private to the owner', async () => {
  const u = await user(),
    other = await user(2);
  const results = await Promise.allSettled([
    service.startReview(u, { repo: 'o/r', prNumber: 3 }),
    service.startReview(u, { repo: 'o/r', prNumber: 3 }),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
  const success = results.find(
    (r) => r.status === 'fulfilled' && r.value.jobId,
  )! as PromiseFulfilledResult<{
    reviewSessionId: string;
    jobId: string | null;
  }>;
  expect(await db.select().from(schema.aiJobs)).toHaveLength(1);
  await expect(service.getReview(other.id, success.value.reviewSessionId)).rejects.toMatchObject({
    code: 'not_found',
  });
  await expect(service.getJob(other.id, success.value.jobId!)).rejects.toMatchObject({
    code: 'not_found',
  });
});
it('requires private AI consent before reserving quota and encrypts user API keys', async () => {
  const u = await user();
  await db.update(schema.users).set({ privateRepoEnabled: true }).where(eq(schema.users.id, u.id));
  privateRepo = true;
  await expect(
    service.startReview({ ...u, privateRepoEnabled: true }, { repo: 'o/r', prNumber: 3 }),
  ).rejects.toMatchObject({ code: 'private_ai_consent_required' });
  expect(await db.select().from(schema.usageCounters)).toHaveLength(0);
  expect(await service.setKey(u.id, 'private-test-key-1234')).toEqual({ last4: '1234' });
  expect((await db.select().from(schema.userApiKeys))[0]?.keyEnc).not.toContain('private-test-key');
});
it('counts user edits once and recovers interrupted jobs without endless retry', async () => {
  const u = await user();
  await recordEdit(db, u.id, 'issue', 'Before', 'After');
  await recordEdit(db, u.id, 'issue', 'After', 'After');
  expect((await service.settings(u.id)).style.pendingEditCount).toBe(1);
  const task = await service.startReview(u, { repo: 'o/r', prNumber: 3 });
  await db
    .update(schema.aiJobs)
    .set({ status: 'running', attempts: 2, updatedAt: new Date(Date.now() - 20 * 60000) })
    .where(eq(schema.aiJobs.id, task.jobId!));
  await recoverAIJobs(db);
  expect((await service.getJob(u.id, task.jobId!)).error).toBe('worker_interrupted');
  expect((await service.getReview(u.id, task.reviewSessionId)).status).toBe('failed');
});
it('creates a default style for a new user without inventing history', async () => {
  const u = await user();
  server.use(
    http.post('https://api.github.com/graphql', () =>
      HttpResponse.json({
        data: {
          user: { contributionsCollection: { pullRequestReviewContributions: { nodes: [] } } },
        },
      }),
    ),
  );
  const job = await service.rebuildStyle(u);
  await service.run(job.jobId);
  expect((await service.settings(u.id)).style).toMatchObject({
    sourceCount: 0,
    profileJson: { tone: 'neutral', focusOrder: ['bug', 'tests', 'readability'] },
  });
});
it('cannot attach another user AI session to a review draft', async () => {
  const owner = await user(),
    other = await user(2);
  const [session] = await db
    .insert(schema.reviewSessions)
    .values({
      userId: owner.id,
      repoFullName: 'o/r',
      prNumber: 3,
      headSha: head,
      playbooks: ['tests'],
      status: 'done',
    })
    .returning();
  await expect(
    workspace.drafts.create(other, {
      kind: 'review',
      repo: 'o/r',
      prNumber: 3,
      payload: {
        headSha: head,
        reviewSessionId: session!.id,
        event: 'COMMENT',
        body: 'Review',
        comments: [],
      },
    }),
  ).rejects.toMatchObject({ code: 'not_found' });
});

it('requires a personal key even when the server has a configured key', async () => {
  const u = await user(1, false),
    other = await user(2);
  await service.setKey(other.id, 'other-users-key-1234');
  await expect(service.translate(u, { text: 'Hello', to: 'zh' })).rejects.toMatchObject({
    code: 'llm_key_required',
  });
  await expect(service.startReview(u, { repo: 'o/r', prNumber: 3 })).rejects.toMatchObject({
    code: 'llm_key_required',
  });
  expect(await db.select().from(schema.aiJobs)).toHaveLength(0);
  expect(await db.select().from(schema.usageCounters)).toHaveLength(0);
});

it('rejects legacy platform jobs before creating a provider, even for a user with a personal key', async () => {
  const u = await user();
  await service.setKey(u.id, 'personal-key-1234');
  const billing: Billing = { source: 'platform', kind: 'aux', day: '2026-11-07' };
  await expect(resolveProvider(db, env, u.id, billing)).rejects.toMatchObject({
    code: 'llm_key_required',
  });
});

it('sends each user personal key to the provider and never falls back after removal or invalid credentials', async () => {
  const first = await user(),
    second = await user(2);
  await service.setKey(first.id, 'first-personal-key-1234');
  await service.setKey(second.id, 'second-personal-key-5678');
  const credentials: string[] = [];
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const authorization = request.headers.get('authorization') ?? '';
    credentials.push(authorization);
    if (authorization === 'Bearer invalid-personal-key')
      return HttpResponse.json({ error: { message: 'Invalid key' } }, { status: 401 });
    return answer(JSON.stringify({ text: 'Translated' }));
  };
  const billing: Billing = { source: 'own', kind: 'aux', day: '2026-11-07' };
  for (const u of [first, second]) {
    const provider = await resolveProvider(db, env, u.id, billing, transport);
    const result = await provider.completeJSON({
      tier: 'fast',
      system: 'Translate',
      user: 'Hello',
      schema: z.object({ text: z.string() }),
    });
    expect(result.data.text).toBe('Translated');
  }
  expect(credentials).toEqual([
    'Bearer first-personal-key-1234',
    'Bearer second-personal-key-5678',
  ]);
  await service.removeKey(first.id);
  await expect(resolveProvider(db, env, first.id, billing, transport)).rejects.toMatchObject({
    code: 'llm_key_missing',
  });
  await expect(service.translate(first, { text: 'Hello', to: 'zh' })).rejects.toMatchObject({
    code: 'llm_key_required',
  });
  await service.setKey(second.id, 'invalid-personal-key');
  const invalidProvider = await resolveProvider(db, env, second.id, billing, transport);
  await expect(
    invalidProvider.completeJSON({
      tier: 'fast',
      system: 'Translate',
      user: 'Hello',
      schema: z.object({ text: z.string() }),
    }),
  ).rejects.toMatchObject({ code: 'llm_key_invalid' });
  expect(credentials).toEqual([
    'Bearer first-personal-key-1234',
    'Bearer second-personal-key-5678',
    'Bearer invalid-personal-key',
  ]);
});
