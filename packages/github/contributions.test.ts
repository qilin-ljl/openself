import { beforeAll, afterAll, afterEach, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createGitHubClient } from './index';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const sha = 'a'.repeat(40);
it('reads a pinned commit tree and blob instead of a moving branch', async () => {
  server.use(
    http.get('https://api.github.com/repos/o/r/git/commits/' + sha, () =>
      HttpResponse.json({ sha, tree: { sha: 'b'.repeat(40) } }),
    ),
    http.get('https://api.github.com/repos/o/r/git/trees/' + 'b'.repeat(40), ({ request }) => {
      expect(new URL(request.url).searchParams.get('recursive')).toBe('1');
      return HttpResponse.json({
        sha: 'b'.repeat(40),
        truncated: false,
        tree: [{ path: 'src.ts', sha: 'c'.repeat(40), type: 'blob', mode: '100644', size: 5 }],
      });
    }),
    http.get('https://api.github.com/repos/o/r/git/blobs/' + 'c'.repeat(40), () =>
      HttpResponse.json({
        sha: 'c'.repeat(40),
        encoding: 'base64',
        content: Buffer.from('hello').toString('base64'),
        size: 5,
      }),
    ),
  );
  const gh = createGitHubClient('fixture', { userId: 'u' });
  const commit = await gh.getGitCommit('o', 'r', sha);
  const tree = await gh.getGitTree('o', 'r', commit.tree.sha);
  expect(tree.tree[0]?.path).toBe('src.ts');
  expect((await gh.getGitBlob('o', 'r', tree.tree[0]!.sha!)).content).toBe('aGVsbG8=');
});
it('does not retry an ambiguous branch creation', async () => {
  let writes = 0;
  server.use(
    http.post('https://api.github.com/repos/o/r/git/refs', () => {
      writes++;
      return new HttpResponse(null, { status: 502 });
    }),
  );
  await expect(
    createGitHubClient('fixture', { userId: 'u' }).createGitRef('o', 'r', 'codex/test', sha),
  ).rejects.toMatchObject({ code: 'unknown' });
  expect(writes).toBe(1);
});
it('creates the requested PR without changing its base or fork head', async () => {
  let sent: unknown;
  server.use(
    http.post('https://api.github.com/repos/o/r/pulls', async ({ request }) => {
      sent = await request.json();
      return HttpResponse.json({ number: 8, html_url: 'https://github.com/o/r/pull/8' });
    }),
  );
  const result = await createGitHubClient('fixture', { userId: 'u' }).createPullRequest('o', 'r', {
    title: 'Fix input',
    body: 'Details',
    base: 'main',
    head: 'alice:codex/test',
    draft: true,
  });
  expect(result).toEqual({ number: 8, url: 'https://github.com/o/r/pull/8' });
  expect(sent).toMatchObject({ base: 'main', head: 'alice:codex/test', draft: true });
});
