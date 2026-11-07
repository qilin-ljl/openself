import { beforeAll, beforeEach, afterEach, afterAll, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createGitHubClient } from '@openself/github';
import type { PullRequestPayload } from '@openself/shared/contributions';
import { publishPreparedPullRequest } from './pull-request-publishing';
const sha = 'a'.repeat(40),
  tree = 'b'.repeat(40),
  blob = 'c'.repeat(40),
  commit = 'd'.repeat(40);
const draftId = '11111111-1111-4111-8111-111111111111';
let push = true,
  head = sha,
  forked = false,
  branchHead: string | null = null;
let mutations: { operation: string; body?: unknown; repo?: string }[] = [];
const server = setupServer(
  http.get('https://api.github.com/user', () => HttpResponse.json({ id: 42, login: 'tester' })),
  http.get('https://api.github.com/repos/upstream/project', () =>
    HttpResponse.json({
      id: 1,
      name: 'project',
      full_name: 'upstream/project',
      private: false,
      archived: false,
      default_branch: 'main',
      permissions: { push },
    }),
  ),
  http.get('https://api.github.com/repos/tester/project', () =>
    forked
      ? HttpResponse.json({
          id: 2,
          name: 'project',
          full_name: 'tester/project',
          fork: true,
          private: false,
          owner: { login: 'tester' },
          parent: { id: 1, full_name: 'upstream/project' },
        })
      : new HttpResponse(null, { status: 404 }),
  ),
  http.get('https://api.github.com/repos/upstream/project/commits/main', () =>
    HttpResponse.json({ sha: head }),
  ),
  http.get('https://api.github.com/repos/:owner/project/git/commits/' + sha, () =>
    HttpResponse.json({ sha, tree: { sha: tree } }),
  ),
  http.get('https://api.github.com/repos/upstream/project/git/trees/' + tree, () =>
    HttpResponse.json({
      truncated: false,
      tree: [{ path: 'src.ts', sha: blob, type: 'blob', mode: '100644' }],
    }),
  ),
  http.get(/https:\/\/api\.github\.com\/repos\/[^/]+\/project\/git\/ref\/.+/, () =>
    branchHead
      ? HttpResponse.json({ object: { sha: branchHead } })
      : new HttpResponse(null, { status: 404 }),
  ),
  http.post('https://api.github.com/repos/upstream/project/forks', () => {
    mutations.push({ operation: 'fork' });
    forked = true;
    return HttpResponse.json(
      { name: 'project', full_name: 'tester/project', owner: { login: 'tester' } },
      { status: 202 },
    );
  }),
  http.post('https://api.github.com/repos/:owner/project/git/refs', async ({ request, params }) => {
    const body = (await request.json()) as { sha: string };
    mutations.push({ operation: 'branch', body, repo: String(params.owner) });
    branchHead = body.sha;
    return HttpResponse.json({ object: { sha: branchHead } });
  }),
  http.post('https://api.github.com/repos/:owner/project/git/blobs', async ({ request }) => {
    mutations.push({ operation: 'blob', body: await request.json() });
    return HttpResponse.json({ sha: 'e'.repeat(40) });
  }),
  http.post('https://api.github.com/repos/:owner/project/git/trees', async ({ request }) => {
    mutations.push({ operation: 'tree', body: await request.json() });
    return HttpResponse.json({ sha: 'f'.repeat(40) });
  }),
  http.post('https://api.github.com/repos/:owner/project/git/commits', async ({ request }) => {
    mutations.push({ operation: 'commit', body: await request.json() });
    return HttpResponse.json({ sha: commit });
  }),
  http.patch(
    /https:\/\/api\.github\.com\/repos\/[^/]+\/project\/git\/refs\/.+/,
    async ({ request }) => {
      const body = (await request.json()) as { sha: string };
      mutations.push({ operation: 'update', body });
      branchHead = body.sha;
      return HttpResponse.json({ object: { sha: branchHead } });
    },
  ),
  http.post('https://api.github.com/repos/upstream/project/pulls', async ({ request }) => {
    mutations.push({ operation: 'pr', body: await request.json() });
    return HttpResponse.json({ number: 7, html_url: 'https://github.com/upstream/project/pull/7' });
  }),
);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  push = true;
  head = sha;
  forked = false;
  branchHead = null;
  mutations = [];
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const payload: PullRequestPayload = {
  repo: 'upstream/project',
  repoId: 1,
  baseBranch: 'main',
  baseSha: sha,
  changeJobId: draftId,
  scanJobId: draftId,
  findingId: draftId,
  title: 'Fix missing input',
  body: 'A reviewed change.',
  verification: ['Run tests'],
  testsExecuted: false,
  aiGenerated: true,
  lang: 'zh',
  asDraft: true,
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
};
const gh = () => createGitHubClient('fixture-token', { userId: 'tester' });
it('writes only a new branch and creates a draft PR after preparing its exact contents', async () => {
  const result = await publishPreparedPullRequest(
    gh(),
    { login: 'tester', githubId: 42 },
    draftId,
    payload,
    () => {},
  );
  expect(result.url).toBe('https://github.com/upstream/project/pull/7');
  expect(mutations.map((m) => m.operation)).toEqual([
    'branch',
    'blob',
    'tree',
    'commit',
    'update',
    'pr',
  ]);
  expect(mutations[0]?.body).toMatchObject({
    ref: 'refs/heads/codex/openself-1111111111114111',
    sha,
  });
  expect(mutations.find((m) => m.operation === 'update')?.body).toMatchObject({
    force: false,
    sha: commit,
  });
  expect(mutations.at(-1)?.body).toMatchObject({
    head: 'codex/openself-1111111111114111',
    base: 'main',
    draft: true,
  });
});
it('uses the authenticated user fork when the upstream repository is not writable', async () => {
  push = false;
  await publishPreparedPullRequest(
    gh(),
    { login: 'tester', githubId: 42 },
    draftId,
    payload,
    () => {},
  );
  expect(mutations[0]?.operation).toBe('fork');
  expect(mutations.find((m) => m.operation === 'branch')?.repo).toBe('tester');
  expect(mutations.at(-1)?.body).toMatchObject({
    head: 'tester:codex/openself-1111111111114111',
    base: 'main',
  });
});
it('refuses a moved base or protected path before any GitHub write', async () => {
  head = '9'.repeat(40);
  await expect(
    publishPreparedPullRequest(gh(), { login: 'tester', githubId: 42 }, draftId, payload, () => {}),
  ).rejects.toMatchObject({ code: 'stale_repository' });
  expect(mutations).toHaveLength(0);
  head = sha;
  await expect(
    publishPreparedPullRequest(
      gh(),
      { login: 'tester', githubId: 42 },
      draftId,
      { ...payload, files: [{ ...payload.files[0]!, path: '.github/workflows/ci.yml' }] },
      () => {},
    ),
  ).rejects.toMatchObject({ code: 'protected_path' });
  expect(mutations).toHaveLength(0);
});
it('does not force-update an existing contribution branch', async () => {
  branchHead = '9'.repeat(40);
  await expect(
    publishPreparedPullRequest(gh(), { login: 'tester', githubId: 42 }, draftId, payload, () => {}),
  ).rejects.toMatchObject({ code: 'contribution_branch_exists' });
  expect(mutations).toHaveLength(0);
});
it('refuses a repository replaced at the same name even when its commit matches', async () => {
  server.use(
    http.get('https://api.github.com/repos/upstream/project', () =>
      HttpResponse.json({
        id: 99,
        name: 'project',
        full_name: 'upstream/project',
        private: false,
        archived: false,
        default_branch: 'main',
        permissions: { push: true },
      }),
    ),
  );
  const originalRepository = { ...payload, repoId: 1 };
  await expect(
    publishPreparedPullRequest(
      gh(),
      { login: 'tester', githubId: 42 },
      draftId,
      originalRepository,
      () => {},
    ),
  ).rejects.toMatchObject({ code: 'stale_repository' });
  expect(mutations).toHaveLength(0);
});
it('creates a new source file without replacing an existing directory or file parent', async () => {
  const created = {
    ...payload,
    files: [
      {
        path: 'test/new.test.ts',
        action: 'create' as const,
        before: '',
        after: 'export const test = true;\n',
        blobSha: null,
        mode: '100644' as const,
      },
    ],
  };
  await publishPreparedPullRequest(
    gh(),
    { login: 'tester', githubId: 42 },
    draftId,
    created,
    () => {},
  );
  expect(mutations.find((item) => item.operation === 'tree')?.body).toMatchObject({
    tree: [{ path: 'test/new.test.ts', mode: '100644', type: 'blob', sha: 'e'.repeat(40) }],
  });
});
it('rejects new files that would replace a directory or turn a file into a parent directory', async () => {
  const created = {
    ...payload,
    files: [
      {
        path: 'src.ts/new.ts',
        action: 'create' as const,
        before: '',
        after: 'export {};\n',
        blobSha: null,
        mode: '100644' as const,
      },
    ],
  };
  await expect(
    publishPreparedPullRequest(gh(), { login: 'tester', githubId: 42 }, draftId, created, () => {}),
  ).rejects.toMatchObject({ code: 'patch_context_mismatch' });
  server.use(
    http.get('https://api.github.com/repos/upstream/project/git/trees/' + tree, () =>
      HttpResponse.json({
        truncated: false,
        tree: [{ path: 'folder.ts', type: 'tree', mode: '040000', sha: tree }],
      }),
    ),
  );
  await expect(
    publishPreparedPullRequest(
      gh(),
      { login: 'tester', githubId: 42 },
      draftId,
      { ...created, files: [{ ...created.files[0]!, path: 'folder.ts' }] },
      () => {},
    ),
  ).rejects.toMatchObject({ code: 'patch_context_mismatch' });
  expect(mutations).toHaveLength(0);
});
