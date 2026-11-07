import { beforeAll, afterAll, afterEach, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createGitHubClient } from '@openself/github';
import type { LLMProvider } from '@openself/llm';
import type { Database } from '@openself/db';
import { parseEnv } from '@openself/shared/env';
import type { RunContext } from './ai-context';
import type { User } from './drafts';
import type { Workspace } from './workspace';
import { discoverProjects, scanRepository, prepareCodeChange } from './contributions';
const head = 'a'.repeat(40),
  treeSha = 'b'.repeat(40),
  blobSha = 'c'.repeat(40);
const code = 'export function read(x) {\n  return x.value;\n}\n';
const repository = {
  id: 1,
  full_name: 'o/r',
  name: 'r',
  owner: { login: 'o' },
  private: false,
  archived: false,
  default_branch: 'main',
  description: 'Example project',
  language: 'TypeScript',
  stargazers_count: 12,
  updated_at: '2026-11-07T00:00:00Z',
  html_url: 'https://github.com/o/r',
};
const server = setupServer(
  http.get('https://api.github.com/search/repositories', () =>
    HttpResponse.json({
      items: [repository, { ...repository, id: 2, full_name: 'o/private', private: true }],
    }),
  ),
  http.get('https://api.github.com/repos/o/r', () => HttpResponse.json(repository)),
  http.get('https://api.github.com/repos/o/r/readme', () =>
    HttpResponse.json({
      path: 'README.md',
      encoding: 'base64',
      content: Buffer.from('An example library').toString('base64'),
    }),
  ),
  http.get('https://api.github.com/repos/o/r/issues', () => HttpResponse.json([])),
  http.get('https://api.github.com/repos/o/r/commits/main', () => HttpResponse.json({ sha: head })),
  http.get('https://api.github.com/repos/o/r/git/commits/' + head, () =>
    HttpResponse.json({ sha: head, tree: { sha: treeSha } }),
  ),
  http.get('https://api.github.com/repos/o/r/git/trees/' + treeSha, () =>
    HttpResponse.json({
      truncated: false,
      tree: [
        { path: 'src.ts', sha: blobSha, mode: '100644', type: 'blob', size: code.length },
        { path: '.env', sha: 'd'.repeat(40), mode: '100644', type: 'blob', size: 100 },
        { path: 'link.ts', sha: 'e'.repeat(40), mode: '120000', type: 'blob', size: 10 },
      ],
    }),
  ),
  http.get('https://api.github.com/repos/o/r/git/blobs/' + blobSha, () =>
    HttpResponse.json({
      sha: blobSha,
      size: code.length,
      encoding: 'base64',
      content: Buffer.from(code).toString('base64'),
    }),
  ),
);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const provider: LLMProvider = {
  async completeJSON(options) {
    let data: unknown;
    if (options.system.includes('[TASK:ideaQueries]')) data = { queries: ['example library'] };
    else if (options.system.includes('[TASK:rankProjects]'))
      data = {
        projects: [
          { repo: 'o/r', reason: 'Matches the idea', directions: ['Handle invalid inputs'] },
          { repo: 'invented/project', reason: 'Hallucinated', directions: [] },
        ],
      };
    else if (options.system.includes('[TASK:repositoryScan]'))
      data = {
        findings: [
          {
            path: 'src.ts',
            line: 2,
            kind: 'bug',
            title: 'Handle absent input',
            explanation: 'Null input throws.',
            evidence: 'return x.value;',
            suggestion: 'Guard absent input.',
            verification: ['Add a null-input test'],
            confidence: 0.9,
          },
          {
            path: 'invented.ts',
            line: 2,
            kind: 'bug',
            title: 'Invented file',
            explanation: '',
            evidence: 'return x.value;',
            suggestion: '',
            verification: [],
            confidence: 0.9,
          },
          {
            path: 'src.ts',
            line: 99,
            kind: 'bug',
            title: 'Invented line',
            explanation: '',
            evidence: 'return x.value;',
            suggestion: '',
            verification: [],
            confidence: 0.9,
          },
        ],
      };
    else
      data = {
        title: 'Guard missing input',
        body: 'Handle a missing argument.',
        verification: ['Run tests'],
        changes: [
          {
            path: 'src.ts',
            action: 'edit',
            edits: [{ original: 'return x.value;', replacement: 'return x?.value;' }],
          },
        ],
      };
    return { data: options.schema.parse(data), usage: { input: 1, output: 1, cacheHit: 0 } };
  },
};
function context(): RunContext {
  const gh = createGitHubClient('fixture', { userId: 'u' });
  return {
    db: {} as Database,
    env: parseEnv({
      APP_URL: 'http://localhost:3000',
      DATABASE_URL: 'postgres://a:b@localhost/db',
      REDIS_URL: 'redis://localhost',
      GITHUB_CLIENT_ID: 'test',
      GITHUB_CLIENT_SECRET: 'test',
      ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    }),
    user: { id: 'u', login: 'alice', privateRepoEnabled: false, locale: 'zh' } as User,
    workspace: {
      githubFor: async () => gh,
      assertRepo: async (_user: User, owner: string, repo: string) => gh.getRepo(owner, repo),
    } as unknown as Workspace,
    provider,
    lang: 'zh',
  };
}
it('only recommends real public API candidates, not invented repositories', async () => {
  const result = await discoverProjects(context(), { idea: 'A library with robust inputs' });
  expect(result.projects.map((project) => project.repo)).toEqual(['o/r']);
  expect(result.projects[0]).toMatchObject({ stars: 12, url: 'https://github.com/o/r' });
});
it('reports pinned evidence and excludes protected or fabricated findings', async () => {
  const result = await scanRepository(context(), { repo: 'o/r', goal: '', maxFiles: 20 });
  expect(result.examinedFiles).toBe(1);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]?.sourceUrl).toBe('https://github.com/o/r/blob/' + head + '/src.ts#L2');
  expect(result.invalidFindings).toBe(2);
  expect(result.skipped).toEqual(
    expect.arrayContaining([
      { path: '.env', reason: 'protected_path' },
      { path: 'link.ts', reason: 'non_regular_file' },
    ]),
  );
});
it('prepares actual code changes without executing tests or publishing anything', async () => {
  const ctx = context(),
    scan = await scanRepository(ctx, { repo: 'o/r', goal: '', maxFiles: 20 });
  const result = await prepareCodeChange(
    ctx,
    scan,
    scan.findings[0]!.id,
    'Add a null guard',
    '11111111-1111-4111-8111-111111111111',
  );
  expect(result.files[0]).toMatchObject({
    path: 'src.ts',
    before: code,
    after: 'export function read(x) {\n  return x?.value;\n}\n',
    blobSha,
  });
  expect(result.testsExecuted).toBe(false);
});
it('rejects private repositories before sending source to a model', async () => {
  server.use(
    http.get('https://api.github.com/repos/o/r', () =>
      HttpResponse.json({ ...repository, private: true }),
    ),
  );
  await expect(
    scanRepository(context(), { repo: 'o/r', goal: '', maxFiles: 20 }),
  ).rejects.toMatchObject({ code: 'scan_public_only' });
});
it('refuses a change proposal when the source branch has moved', async () => {
  const ctx = context(),
    scan = await scanRepository(ctx, { repo: 'o/r', goal: '', maxFiles: 20 });
  server.use(
    http.get('https://api.github.com/repos/o/r/commits/main', () =>
      HttpResponse.json({ sha: 'f'.repeat(40) }),
    ),
  );
  await expect(
    prepareCodeChange(
      ctx,
      scan,
      scan.findings[0]!.id,
      'Fix it',
      '11111111-1111-4111-8111-111111111111',
    ),
  ).rejects.toMatchObject({ code: 'stale_repository' });
});
