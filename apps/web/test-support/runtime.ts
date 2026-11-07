import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { http, HttpResponse, getResponse } from 'msw';
import { resolveProvider } from '@openself/core/ai-billing';
import { schema, type Database } from '@openself/db';
import { databaseSessionStore } from '@openself/db/session-store';
import { createSessionService } from '@openself/core/session';
import { encrypt } from '@openself/core/crypto';
import { createWorkspace, type Workspace } from '@openself/core/workspace';
import { createAIService, type AIService } from '@openself/core/ai-service';
import { parseEnv } from '@openself/shared/env';
import { testAuthEnabled } from '../lib/test-context';
export async function initializeTestContext() {
  if (!testAuthEnabled() || globalThis.__openselfTestContext) return;
  const pg = new PGlite(),
    db = drizzle(pg, { schema }) as unknown as Database;
  await migrate(drizzle(pg), {
    migrationsFolder: resolve(process.cwd(), '../../packages/db/migrations'),
  });
  const env = parseEnv({
    APP_URL: process.env.APP_URL ?? 'http://localhost:3000',
    DATABASE_URL: 'postgres://test:test@localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    GITHUB_CLIENT_ID: 'test-client',
    GITHUB_CLIENT_SECRET: 'test-secret',
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    DEV_TEST_REPO: 'tester/sandbox',
    EXTENSION_IDS: process.env.EXTENSION_IDS || 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  });
  const [user] = await db
    .insert(schema.users)
    .values({ githubId: 900001, login: 'test-contributor', name: 'Test Contributor' })
    .returning();
  await db.insert(schema.oauthTokens).values({
    userId: user!.id,
    accessTokenEnc: encrypt('test-only-token', env.ENCRYPTION_KEY),
    scopes: 'public_repo',
  });
  await db.insert(schema.userApiKeys).values({
    userId: user!.id,
    keyEnc: encrypt('test-personal-key-1234', env.ENCRYPTION_KEY),
    last4: '1234',
  });
  const [contributionUser] = await db
    .insert(schema.users)
    .values({
      githubId: 900002,
      login: 'contribution-tester',
      name: 'Contribution Tester',
    })
    .returning();
  await db.insert(schema.oauthTokens).values({
    userId: contributionUser!.id,
    accessTokenEnc: encrypt('test-contributions-token', env.ENCRYPTION_KEY),
    scopes: 'public_repo',
  });
  await db.insert(schema.userApiKeys).values({
    userId: contributionUser!.id,
    keyEnc: encrypt('test-contributions-key-5678', env.ENCRYPTION_KEY),
    last4: '5678',
  });
  const repository = {
    id: 1,
    name: 'sandbox',
    full_name: 'tester/sandbox',
    html_url: 'https://github.com/tester/sandbox',
    description: 'A test repository for OpenSelf issue and review workflows.',
    private: false,
    archived: false,
    has_issues: true,
    default_branch: 'main',
    stargazers_count: 12,
    language: 'TypeScript',
    updated_at: '2026-11-06T00:00:00Z',
    permissions: { push: true },
    owner: { login: 'tester' },
  };
  const ownedRepository = {
    ...repository,
    id: 4,
    name: 'playground',
    full_name: 'test-contributor/playground',
    html_url: 'https://github.com/test-contributor/playground',
    owner: { login: 'test-contributor' },
  };
  const form =
    'name: Bug report\ndescription: Report a reproducible bug\nbody:\n  - type: input\n    id: version\n    attributes:\n      label: Version\n    validations:\n      required: true\n  - type: textarea\n    id: steps\n    attributes:\n      label: Steps to reproduce\n    validations:\n      required: true';
  const issue = {
    id: 2,
    number: 2,
    title: 'Example issue: handle empty results',
    body: 'Test fixture discussion.',
    html_url: 'https://github.com/tester/sandbox/issues/2',
    created_at: '2026-11-06T00:00:00Z',
    user: { login: 'tester' },
    state: 'open',
  };
  let number = 20;
  const pull = {
    id: 3,
    number: 3,
    title: 'Handle empty review input',
    body: 'This fixture adds input validation and a focused test.',
    html_url: 'https://github.com/tester/sandbox/pull/3',
    state: 'open',
    head: { sha: 'a'.repeat(40), ref: 'fix/empty-input' },
    base: { sha: 'b'.repeat(40), ref: 'main' },
    user: { login: 'another-contributor' },
    created_at: '2026-11-06T00:00:00Z',
    changed_files: 2,
  };
  const files = [
    {
      filename: 'src/review.ts',
      status: 'modified',
      additions: 3,
      deletions: 1,
      patch:
        '@@ -1,4 +1,6 @@\n export function review(input: string) {\n-  return input.trim();\n+  if (!input) return null;\n+  const value = input.trim();\n+  return value;\n }\n ',
    },
    {
      filename: 'test/review.test.ts',
      status: 'added',
      additions: 4,
      deletions: 0,
      patch:
        '@@ -0,0 +1,4 @@\n+import { review } from "../src/review";\n+test("empty input", () => {\n+  expect(review("")).toBeNull();\n+});',
    },
  ];
  const sourceBody =
    'export function review(input: string) {\n  if (!input) return null;\n  const value = input.trim();\n  return value;\n}\n';
  const contributionRefs = new Map<string, string>();
  const handlers = [
    http.get('https://api.github.com/user', ({ request }) =>
      HttpResponse.json(
        request.headers.get('authorization')?.includes('test-contributions-token')
          ? { id: 900002, login: 'contribution-tester' }
          : { id: 900001, login: 'test-contributor' },
      ),
    ),
    http.get('https://api.github.com/repos/tester/sandbox/commits/main', () =>
      HttpResponse.json({ sha: 'b'.repeat(40) }),
    ),
    http.get('https://api.github.com/repos/tester/sandbox/git/commits/:sha', ({ params }) =>
      HttpResponse.json({ sha: params.sha, tree: { sha: 'c'.repeat(40) } }),
    ),
    http.get('https://api.github.com/repos/tester/sandbox/git/trees/:sha', () =>
      HttpResponse.json({
        truncated: false,
        tree: [
          {
            path: 'src/review.ts',
            mode: '100644',
            type: 'blob',
            sha: 'd'.repeat(40),
            size: sourceBody.length,
          },
          { path: '.env', mode: '100644', type: 'blob', sha: '9'.repeat(40), size: 50 },
        ],
      }),
    ),
    http.get('https://api.github.com/repos/tester/sandbox/git/blobs/:sha', ({ params }) =>
      HttpResponse.json({
        sha: params.sha,
        encoding: 'base64',
        size: sourceBody.length,
        content: Buffer.from(sourceBody).toString('base64'),
      }),
    ),
    http.get(/https:\/\/api\.github\.com\/repos\/tester\/sandbox\/git\/ref\/.+/, ({ request }) => {
      const ref = decodeURIComponent(new URL(request.url).pathname.split('/git/ref/')[1]!);
      const sha = contributionRefs.get(ref);
      return sha ? HttpResponse.json({ object: { sha } }) : new HttpResponse(null, { status: 404 });
    }),
    http.post('https://api.github.com/repos/tester/sandbox/git/refs', async ({ request }) => {
      const body = (await request.json()) as { ref: string; sha: string };
      contributionRefs.set(body.ref.replace(/^refs\//, ''), body.sha);
      return HttpResponse.json({ object: { sha: body.sha } });
    }),
    http.post('https://api.github.com/repos/tester/sandbox/git/blobs', () =>
      HttpResponse.json({ sha: 'e'.repeat(40) }),
    ),
    http.post('https://api.github.com/repos/tester/sandbox/git/trees', () =>
      HttpResponse.json({ sha: 'f'.repeat(40) }),
    ),
    http.post('https://api.github.com/repos/tester/sandbox/git/commits', () =>
      HttpResponse.json({ sha: '1'.repeat(40) }),
    ),
    http.patch(
      /https:\/\/api\.github\.com\/repos\/tester\/sandbox\/git\/refs\/.+/,
      async ({ request }) => {
        const ref = decodeURIComponent(new URL(request.url).pathname.split('/git/refs/')[1]!);
        const body = (await request.json()) as { sha: string; force: boolean };
        if (!ref.startsWith('heads/codex/openself-') || body.force)
          return new HttpResponse(null, { status: 422 });
        contributionRefs.set(ref, body.sha);
        return HttpResponse.json({ object: { sha: body.sha } });
      },
    ),
    http.post('https://api.github.com/repos/tester/sandbox/pulls', async ({ request }) => {
      const body = (await request.json()) as { head: string; base: string; draft: boolean };
      if (
        body.base !== 'main' ||
        !body.head.startsWith('codex/openself-') ||
        !contributionRefs.has('heads/' + body.head)
      )
        return new HttpResponse(null, { status: 422 });
      return HttpResponse.json({
        number: 99,
        html_url: 'https://github.com/tester/sandbox/pull/99',
      });
    }),
    http.get('https://api.github.com/user/repos', () =>
      HttpResponse.json([
        ownedRepository,
        {
          ...ownedRepository,
          id: 5,
          name: 'private-repo',
          full_name: 'test-contributor/private-repo',
          private: true,
        },
        repository,
      ]),
    ),
    http.get('https://api.github.com/repos/test-contributor/playground', () =>
      HttpResponse.json(ownedRepository),
    ),
    http.get('https://api.github.com/repos/test-contributor/playground/readme', () =>
      HttpResponse.json({
        path: 'README.md',
        encoding: 'base64',
        content: Buffer.from('# Owned fixture repository').toString('base64'),
      }),
    ),
    http.get(
      'https://api.github.com/repos/test-contributor/playground/contents/:path',
      () => new HttpResponse(null, { status: 404 }),
    ),
    http.get('https://api.github.com/repos/test-contributor/playground/pulls', () =>
      HttpResponse.json([
        { ...pull, html_url: 'https://github.com/test-contributor/playground/pull/3' },
      ]),
    ),
    http.get('https://api.github.com/repos/test-contributor/playground/pulls/3', () =>
      HttpResponse.json({
        ...pull,
        html_url: 'https://github.com/test-contributor/playground/pull/3',
      }),
    ),
    http.get('https://api.github.com/repos/test-contributor/playground/pulls/3/files', () =>
      HttpResponse.json(files),
    ),
    http.get(
      'https://api.github.com/repos/test-contributor/playground/commits/:sha/check-runs',
      () => HttpResponse.json({ total_count: 0, check_runs: [] }),
    ),
    http.get('https://api.github.com/search/repositories', () =>
      HttpResponse.json({ total_count: 1, incomplete_results: false, items: [repository] }),
    ),
    http.get('https://api.github.com/search/issues', () =>
      HttpResponse.json({ total_count: 0, incomplete_results: false, items: [] }),
    ),
    http.get('https://api.github.com/repos/tester/sandbox', () => HttpResponse.json(repository)),
    http.get('https://api.github.com/repos/tester/sandbox/readme', () =>
      HttpResponse.json({
        path: 'README.md',
        encoding: 'base64',
        content: Buffer.from(
          '# OpenSelf test repository\n\nThis is a simulated repository for end-to-end tests.\n\n## Contributing\nDescribe a reproducible issue or review the test PR.',
        ).toString('base64'),
      }),
    ),
    http.get('https://api.github.com/repos/tester/sandbox/contents/:path', ({ params }) => {
      const path = decodeURIComponent(String(params.path));
      if (path === '.github/ISSUE_TEMPLATE')
        return HttpResponse.json([
          { type: 'file', name: 'bug.yml', path: '.github/ISSUE_TEMPLATE/bug.yml' },
        ]);
      if (path === '.github/ISSUE_TEMPLATE/bug.yml')
        return HttpResponse.json({
          encoding: 'base64',
          content: Buffer.from(form).toString('base64'),
        });
      if (path === 'CONTRIBUTING.md')
        return HttpResponse.json({
          encoding: 'base64',
          content: Buffer.from(
            '## Before opening an issue\n\nInclude a version and reproduction steps.',
          ).toString('base64'),
        });
      return new HttpResponse(null, { status: 404 });
    }),
    http.get('https://api.github.com/repos/tester/sandbox/issues', () =>
      HttpResponse.json([issue]),
    ),
    http.get('https://api.github.com/repos/tester/sandbox/pulls', () => HttpResponse.json([pull])),
    http.get('https://api.github.com/repos/tester/sandbox/pulls/3', () => HttpResponse.json(pull)),
    http.get('https://api.github.com/repos/tester/sandbox/pulls/3/files', () =>
      HttpResponse.json(files),
    ),
    http.get('https://api.github.com/repos/tester/sandbox/commits/:sha/check-runs', () =>
      HttpResponse.json({
        total_count: 1,
        check_runs: [
          {
            id: 1,
            name: 'Unit tests',
            status: 'completed',
            conclusion: 'success',
            html_url: 'https://github.com/tester/sandbox/actions/runs/1',
          },
        ],
      }),
    ),
    http.post(
      'https://api.github.com/repos/tester/sandbox/pulls/3/reviews',
      async ({ request }) => {
        const body = (await request.json()) as { commit_id: string; comments: unknown[] };
        if (body.commit_id !== pull.head.sha)
          return HttpResponse.json({ message: 'stale head' }, { status: 422 });
        return HttpResponse.json({
          id: 100,
          html_url: 'https://github.com/tester/sandbox/pull/3#pullrequestreview-100',
        });
      },
    ),
    http.post('https://api.github.com/repos/tester/sandbox/issues', async ({ request }) => {
      const payload = (await request.json()) as { title: string; body: string };
      number++;
      return HttpResponse.json(
        {
          ...issue,
          ...payload,
          number,
          html_url: 'https://github.com/tester/sandbox/issues/' + number,
        },
        { status: 201 },
      );
    }),
    http.all('https://api.github.com/*', () =>
      HttpResponse.json({ message: 'Missing test fixture' }, { status: 404 }),
    ),
    http.post('https://api.deepseek.com/chat/completions', async ({ request }) => {
      const payload = (await request.json()) as { messages: { content: string }[] };
      const system = payload.messages[0]?.content ?? '';
      let result: unknown = {};
      if (system.includes('[TASK:ideaQueries]')) result = { queries: ['sandbox'] };
      else if (system.includes('[TASK:rankProjects]'))
        result = {
          projects: [
            {
              repo: 'tester/sandbox',
              reason: 'A real fixture matching input-validation work.',
              directions: ['Improve whitespace handling'],
            },
          ],
        };
      else if (system.includes('[TASK:repositoryScan]'))
        result = {
          findings: [
            {
              path: 'src/review.ts',
              line: 4,
              kind: 'bug',
              title: 'Handle whitespace-only input',
              explanation: 'The trimmed value can be an empty string.',
              evidence: 'return value;',
              suggestion: 'Return null for whitespace-only input.',
              verification: ['Add a whitespace-only test'],
              confidence: 0.9,
              relatedIssues: [],
            },
          ],
        };
      else if (system.includes('[TASK:codeChanges]'))
        result = {
          title: 'Guard whitespace-only input',
          body: 'Return null for whitespace-only inputs.',
          verification: ['Add and run a whitespace-only regression test'],
          changes: [
            {
              path: 'src/review.ts',
              action: 'edit',
              edits: [{ original: 'return value;', replacement: 'return value || null;' }],
            },
          ],
        };
      else if (system.includes('[TASK:riskScore]'))
        result = {
          files: [
            { path: 'src/review.ts', score: 4, reasons: ['Input behavior changes'] },
            { path: 'test/review.test.ts', score: 2, reasons: ['Test addition'] },
          ],
        };
      else if (system.includes('[TASK:review]'))
        result = {
          findings: [
            {
              path: 'src/review.ts',
              line: 3,
              side: 'RIGHT',
              severity: 'major',
              category: 'bug',
              title: 'Handle whitespace-only input',
              body: 'Whitespace-only input produces an empty string instead of null. Cover this case explicitly.',
              confidence: 0.9,
            },
          ],
        };
      else if (system.includes('[TASK:keywords]')) result = { keywords: ['empty input'] };
      else if (system.includes('[TASK:dedupe]')) result = { candidates: [] };
      else if (system.includes('[TASK:issueDraft]'))
        result = {
          title: 'AI draft: empty input crashes',
          body: '## Reproduction\nOpen the app with an empty input.\n\n## Expected\nShow an actionable validation message.',
          fields: { version: '1.0', steps: 'Open the app with an empty input.' },
          missingInfo: [],
          labels: [],
        };
      else if (system.includes('[TASK:issueQuality]'))
        result = {
          score: 80,
          checks: [{ name: 'Reproduction steps', pass: true, tip: 'Concrete steps are provided.' }],
        };
      else if (system.includes('[TASK:translate]'))
        result = { text: 'Translated draft for the test repository.' };
      else if (system.includes('[TASK:rewrite]')) result = { items: [] };
      else if (system.includes('[TASK:rulecard]'))
        result = {
          summary: 'Use focused tests.',
          naming: [],
          commitConvention: null,
          testing: ['Add a regression test'],
          topConcerns: [],
          doNot: [],
        };
      else if (system.includes('[TASK:styleProfile]'))
        result = {
          focusOrder: ['bug', 'tests'],
          tone: 'neutral',
          usesQuestions: true,
          givesCodeSuggestions: true,
          language: 'en',
          phrases: [],
          notes: '',
          profileMd: 'A neutral style focused on correctness.',
        };
      return HttpResponse.json({
        id: 'fixture',
        object: 'chat.completion',
        created: 1,
        model: 'fixture',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: JSON.stringify(result) },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 10 },
      });
    }),
    http.all('https://api.deepseek.com/*', () => new HttpResponse(null, { status: 404 })),
  ];
  const transport: typeof fetch = async (input, init) =>
    (await getResponse(handlers, new Request(input, init))) ?? new Response(null, { status: 404 });
  const data = new Map<string, string>();
  const workspace: Workspace = createWorkspace(db, env, {
    fetch: transport,
    cache: {
      async get(key) {
        return data.get(key) ?? null;
      },
      async set(key, value) {
        data.set(key, value);
      },
    },
    enqueue: async (id) => {
      setTimeout(() => void workspace.drafts.publish(id), 25);
    },
  });
  const ai: AIService = createAIService({
    db,
    env,
    workspace,
    provider: (userId, billing, observe) =>
      resolveProvider(db, env, userId, billing, transport, observe),
    enqueue: async (id) => {
      setTimeout(async () => {
        try {
          await ai.run(id);
        } catch {
          try {
            await ai.run(id);
          } catch {
            /* Persisted error is shown in tests. */
          }
        }
      }, 25);
    },
  });
  globalThis.__openselfTestContext = {
    db,
    env,
    sessions: createSessionService(databaseSessionStore(db)),
    workspace,
    userId: user!.id,
    contributionUserId: contributionUser!.id,
    ai,
  };
}
