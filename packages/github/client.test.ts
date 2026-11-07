import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createGitHubClient, type CacheStore } from './index';
const data = new Map<string, string>();
const cache: CacheStore = {
  async get(key) {
    return data.get(key) ?? null;
  },
  async set(key, value) {
    data.set(key, value);
  },
};
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  data.clear();
});
afterAll(() => server.close());
it('conditionally revalidates cached responses and isolates users', async () => {
  const headers: (string | null)[] = [];
  server.use(
    http.get('https://api.github.com/user', ({ request }) => {
      headers.push(request.headers.get('if-none-match'));
      return request.headers.get('if-none-match')
        ? new HttpResponse(null, { status: 304 })
        : HttpResponse.json({ login: 'alice' }, { headers: { etag: '"v1"' } });
    }),
  );
  const a = createGitHubClient('token-a', { userId: 'alice', cache });
  expect((await a.getViewer()).login).toBe('alice');
  expect((await a.getViewer()).login).toBe('alice');
  await createGitHubClient('token-b', { userId: 'bob', cache }).getViewer();
  expect(headers).toEqual([null, '"v1"', null]);
});
it('excludes pull requests from the issues list', async () => {
  server.use(
    http.get('https://api.github.com/repos/o/r/issues', () =>
      HttpResponse.json([
        { number: 1, title: 'Bug' },
        { number: 2, title: 'PR', pull_request: { url: 'x' } },
      ]),
    ),
  );
  expect(
    (await createGitHubClient('x', { userId: 'u' }).listIssues('o', 'r')).items.map(
      (i) => i.number,
    ),
  ).toEqual([1]);
});
it('does not retry a possibly successful POST on server errors', async () => {
  let writes = 0;
  server.use(
    http.post('https://api.github.com/repos/o/r/issues', () => {
      writes++;
      return new HttpResponse(null, { status: 502 });
    }),
  );
  await expect(
    createGitHubClient('x', { userId: 'u' }).createIssue('o', 'r', { title: 'Bug', body: 'Steps' }),
  ).rejects.toMatchObject({ code: 'unknown' });
  expect(writes).toBe(1);
});
it('turns rate limiting into a safe code without returning token data', async () => {
  server.use(
    http.get('https://api.github.com/user', () =>
      HttpResponse.json(
        { message: 'private-token' },
        { status: 403, headers: { 'x-ratelimit-remaining': '0' } },
      ),
    ),
  );
  await expect(
    createGitHubClient('private-token', { userId: 'u' }).getViewer(),
  ).rejects.toMatchObject({ code: 'rate_limited', message: 'rate_limited' });
});
it('paginates PR files and retains binary files without inventing a patch', async () => {
  server.use(
    http.get('https://api.github.com/repos/o/r/pulls/3/files', ({ request }) =>
      HttpResponse.json(
        new URL(request.url).searchParams.get('page') === '1'
          ? Array.from({ length: 100 }, (_, i) => ({
              filename: 'src/' + i + '.ts',
              patch: '@@ -1 +1 @@\n-old\n+new',
            }))
          : [{ filename: 'image.png' }],
      ),
    ),
  );
  const result = await createGitHubClient('x', { userId: 'u' }).listPullFiles('o', 'r', 3);
  expect(result.files).toHaveLength(101);
  expect(result.files[100]?.patch).toBeUndefined();
  expect(result.truncated).toBe(false);
});
it('checks the current PR head immediately before a review write', async () => {
  let writes = 0;
  server.use(
    http.get('https://api.github.com/repos/o/r/pulls/3/files', () => HttpResponse.json([])),
    http.get('https://api.github.com/repos/o/r/pulls/3', () =>
      HttpResponse.json({ head: { sha: 'b'.repeat(40) } }),
    ),
    http.post('https://api.github.com/repos/o/r/pulls/3/reviews', () => {
      writes++;
      return HttpResponse.json({});
    }),
  );
  await expect(
    createGitHubClient('x', { userId: 'u' }).submitReview('o', 'r', 3, {
      commit_id: 'a'.repeat(40),
      event: 'COMMENT',
      body: 'Review',
      comments: [],
    }),
  ).rejects.toMatchObject({ code: 'stale_head' });
  expect(writes).toBe(0);
});
