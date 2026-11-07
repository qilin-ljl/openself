import { createHash } from 'node:crypto';
import { Octokit } from '@octokit/rest';
import { throttling } from '@octokit/plugin-throttling';
import { retry } from '@octokit/plugin-retry';
import { AppError } from '@openself/shared/errors';
import { normalizeComments, type ReviewComment } from './review';
import { parseTemplate, parseTemplateConfig, type IssueTemplate } from './templates';
export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}
export class GitHubError extends AppError {
  constructor(code: string, status: number) {
    super(code, status);
    this.name = 'GitHubError';
  }
}
export function mapGitHubError(error: unknown): GitHubError {
  if (error instanceof GitHubError) return error;
  const e = error as { status?: number; response?: { headers?: Record<string, string> } };
  const status = e.status ?? 502;
  const headers = e.response?.headers;
  return new GitHubError(
    status === 401
      ? 'unauthorized'
      : status === 429 ||
          (status === 403 &&
            (headers?.['x-ratelimit-remaining'] === '0' || !!headers?.['retry-after']))
        ? 'rate_limited'
        : status === 403
          ? 'forbidden'
          : status === 404
            ? 'not_found'
            : status === 422
              ? 'validation'
              : 'unknown',
    status,
  );
}
const Client = Octokit.plugin(throttling, retry);
export function createGitHubClient(
  token: string,
  options: {
    userId: string;
    cache?: CacheStore;
    onUnauthorized?: () => Promise<void>;
    fetch?: typeof fetch;
  },
) {
  const octokit = new Client({
    auth: token,
    userAgent: 'OpenSelf/0.1',
    request: { timeout: 15000, ...(options.fetch ? { fetch: options.fetch } : {}) },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    throttle: { onRateLimit: () => false, onSecondaryRateLimit: () => false },
  });
  const prefix = `gh:${options.userId}:${createHash('sha256').update(token).digest('hex').slice(0, 16)}:`;
  async function request<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      const mapped = mapGitHubError(error);
      if (mapped.code === 'unauthorized') await options.onUnauthorized?.();
      throw mapped;
    }
  }
  async function read<T>(
    key: string,
    fn: (headers: Record<string, string>) => Promise<{ data: T; headers: { etag?: string } }>,
    fresh = false,
  ): Promise<T> {
    let cached: { etag?: string; data: T } | undefined;
    if (!fresh && options.cache) {
      try {
        const raw = await options.cache.get(prefix + key);
        if (raw) cached = JSON.parse(raw);
      } catch {
        /* A cache outage must not prevent a live read. */
      }
    }
    return request(async () => {
      try {
        const response = await fn(cached?.etag ? { 'if-none-match': cached.etag } : {});
        if (options.cache) {
          try {
            await options.cache.set(
              prefix + key,
              JSON.stringify({ etag: response.headers.etag, data: response.data }),
              600,
            );
          } catch {
            /* Cache is optional. */
          }
        }
        return response.data;
      } catch (error) {
        if ((error as { status?: number }).status === 304 && cached) return cached.data;
        throw error;
      }
    });
  }
  const params = (owner: string, repo: string) => ({ owner, repo });
  async function getFileContent(owner: string, repo: string, path: string, ref?: string) {
    const result = await read(`file:${owner}/${repo}/${path}@${ref ?? ''}`, (headers) =>
      octokit.rest.repos.getContent({ ...params(owner, repo), path, ref, headers }),
    );
    if (Array.isArray(result) || !('content' in result) || result.encoding !== 'base64')
      return null;
    return Buffer.from(result.content, 'base64').toString('utf8');
  }
  async function optionalFile(owner: string, repo: string, path: string) {
    try {
      return await getFileContent(owner, repo, path);
    } catch (error) {
      if (error instanceof GitHubError && error.code === 'not_found') return null;
      throw error;
    }
  }
  const getPull = (owner: string, repo: string, n: number, fresh = false) =>
    read(
      `pull:${owner}/${repo}:${n}`,
      (headers) => octokit.rest.pulls.get({ ...params(owner, repo), pull_number: n, headers }),
      fresh,
    );
  async function listPullFiles(owner: string, repo: string, n: number, fresh = false) {
    const files: Awaited<ReturnType<typeof octokit.rest.pulls.listFiles>>['data'] = [];
    for (let page = 1; page <= 30; page++) {
      const batch = await read(
        `files:${owner}/${repo}:${n}:${page}`,
        (headers) =>
          octokit.rest.pulls.listFiles({
            ...params(owner, repo),
            pull_number: n,
            page,
            per_page: 100,
            headers,
          }),
        fresh,
      );
      files.push(...batch);
      if (batch.length < 100) return { files, truncated: false };
    }
    return { files, truncated: true };
  }
  return {
    getPull,
    getIssue: (owner: string, repo: string, number: number) =>
      read(`issue:${owner}/${repo}:${number}`, (headers) =>
        octokit.rest.issues.get({ owner, repo, issue_number: number, headers }),
      ),
    listPullFiles,
    getGitCommit: (owner: string, repo: string, sha: string) =>
      read('git-commit:' + owner + '/' + repo + '@' + sha, (headers) =>
        octokit.rest.git.getCommit({ owner, repo, commit_sha: sha, headers }),
      ),
    getGitTree: (owner: string, repo: string, sha: string) =>
      read('git-tree:' + owner + '/' + repo + '@' + sha, (headers) =>
        octokit.rest.git.getTree({ owner, repo, tree_sha: sha, recursive: '1', headers }),
      ),
    getGitBlob: (owner: string, repo: string, sha: string) =>
      read('git-blob:' + owner + '/' + repo + '@' + sha, (headers) =>
        octokit.rest.git.getBlob({ owner, repo, file_sha: sha, headers }),
      ),
    getGitRef: (owner: string, repo: string, branch: string) =>
      read(
        'git-ref:' + owner + '/' + repo + '@' + branch,
        (headers) => octokit.rest.git.getRef({ owner, repo, ref: 'heads/' + branch, headers }),
        true,
      ),
    createFork: (owner: string, repo: string) =>
      request(
        async () =>
          (
            await octokit.rest.repos.createFork({
              owner,
              repo,
              default_branch_only: false,
              request: { retries: 0 },
            })
          ).data,
      ),
    createGitRef: (owner: string, repo: string, branch: string, sha: string) =>
      request(
        async () =>
          (
            await octokit.rest.git.createRef({
              owner,
              repo,
              ref: 'refs/heads/' + branch,
              sha,
              request: { retries: 0 },
            })
          ).data,
      ),
    createGitBlob: (owner: string, repo: string, content: string) =>
      request(
        async () =>
          (
            await octokit.rest.git.createBlob({
              owner,
              repo,
              content: Buffer.from(content, 'utf8').toString('base64'),
              encoding: 'base64',
              request: { retries: 0 },
            })
          ).data.sha,
      ),
    createGitTree: (
      owner: string,
      repo: string,
      baseTree: string,
      tree: { path: string; mode: '100644' | '100755'; type: 'blob'; sha: string }[],
    ) =>
      request(
        async () =>
          (
            await octokit.rest.git.createTree({
              owner,
              repo,
              base_tree: baseTree,
              tree,
              request: { retries: 0 },
            })
          ).data.sha,
      ),
    createGitCommit: (owner: string, repo: string, message: string, tree: string, parent: string) =>
      request(
        async () =>
          (
            await octokit.rest.git.createCommit({
              owner,
              repo,
              message,
              tree,
              parents: [parent],
              request: { retries: 0 },
            })
          ).data.sha,
      ),
    updateGitRef: (owner: string, repo: string, branch: string, sha: string) =>
      request(
        async () =>
          (
            await octokit.rest.git.updateRef({
              owner,
              repo,
              ref: 'heads/' + branch,
              sha,
              force: false,
              request: { retries: 0 },
            })
          ).data,
      ),
    createPullRequest: (
      owner: string,
      repo: string,
      data: { title: string; body: string; base: string; head: string; draft: boolean },
    ) =>
      request(async () => {
        const result = await octokit.rest.pulls.create({
          owner,
          repo,
          ...data,
          request: { retries: 0 },
        });
        return { number: result.data.number, url: result.data.html_url };
      }),
    getBranchSha: async (owner: string, repo: string, ref: string) => {
      const result = await read(`commit:${owner}/${repo}:${ref}`, (headers) =>
        octokit.rest.repos.getCommit({ owner, repo, ref, headers }),
      );
      return result.sha;
    },
    async getUserRepos() {
      const repos: Awaited<ReturnType<typeof octokit.rest.repos.listForAuthenticatedUser>>['data'] =
        [];
      for (let page = 1; page <= 3; page++) {
        const batch = await read('owned-repos:' + page, (headers) =>
          octokit.rest.repos.listForAuthenticatedUser({
            affiliation: 'owner',
            sort: 'updated',
            per_page: 100,
            page,
            headers,
          }),
        );
        repos.push(...batch);
        if (batch.length < 100) break;
      }
      return repos;
    },
    async getRecentMaintainerComments(owner: string, repo: string, signal?: AbortSignal) {
      const pulls = await read(`merged:${owner}/${repo}`, (headers) =>
        octokit.rest.pulls.list({
          owner,
          repo,
          state: 'closed',
          sort: 'updated',
          direction: 'desc',
          per_page: 30,
          headers,
          request: { signal, retries: 0 },
        }),
      );
      const result: string[] = [];
      for (const pull of pulls.filter((p) => p.merged_at).slice(0, 15)) {
        signal?.throwIfAborted();
        const [comments, reviews] = await Promise.all([
          read(`maintainer-comments:${owner}/${repo}:${pull.number}`, (headers) =>
            octokit.rest.pulls.listReviewComments({
              owner,
              repo,
              pull_number: pull.number,
              per_page: 100,
              headers,
              request: { signal, retries: 0 },
            }),
          ),
          read(`maintainer-reviews:${owner}/${repo}:${pull.number}`, (headers) =>
            octokit.rest.pulls.listReviews({
              owner,
              repo,
              pull_number: pull.number,
              per_page: 100,
              headers,
              request: { signal, retries: 0 },
            }),
          ),
        ]);
        for (const comment of [...comments, ...reviews])
          if (
            ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(comment.author_association) &&
            comment.body
          )
            result.push(comment.body.slice(0, 500));
        if (result.length >= 200) break;
      }
      return result.slice(0, 200);
    },
    async getUserReviewComments(login: string, allowPrivate = false) {
      try {
        const result = await octokit.graphql<{
          user: {
            contributionsCollection: {
              pullRequestReviewContributions: {
                nodes: {
                  pullRequestReview: {
                    body: string;
                    author: { login: string } | null;
                    pullRequest: { repository: { isPrivate: boolean } };
                    comments: { nodes: { body: string; author: { login: string } | null }[] };
                  };
                }[];
              };
            };
          };
        }>(
          'query($login:String!){user(login:$login){contributionsCollection{pullRequestReviewContributions(first:100){nodes{pullRequestReview{body author{login} pullRequest{repository{isPrivate}} comments(first:100){nodes{body author{login}}}}}}}}}',
          { login },
        );
        return result.user.contributionsCollection.pullRequestReviewContributions.nodes
          .flatMap((n) => {
            const r = n.pullRequestReview;
            if (r.pullRequest.repository.isPrivate && !allowPrivate) return [];
            return [r, ...r.comments.nodes]
              .filter((c) => c.author?.login === login && c.body)
              .map((c) => c.body);
          })
          .slice(0, 200);
      } catch {
        const search = await read('reviewed-by:' + login + ':' + allowPrivate, (headers) =>
          octokit.rest.search.issuesAndPullRequests({
            q: `is:pr reviewed-by:${login}${allowPrivate ? '' : ' is:public'}`,
            per_page: 30,
            headers,
          }),
        );
        const bodies: string[] = [];
        for (const pull of search.items) {
          const [owner, repo] = new URL(pull.html_url).pathname.split('/').slice(1, 3) as [
            string,
            string,
          ];
          const [comments, reviews] = await Promise.all([
            read('style-comments:' + pull.id, (headers) =>
              octokit.rest.pulls.listReviewComments({
                owner,
                repo,
                pull_number: pull.number,
                per_page: 100,
                headers,
              }),
            ),
            read('style-reviews:' + pull.id, (headers) =>
              octokit.rest.pulls.listReviews({
                owner,
                repo,
                pull_number: pull.number,
                per_page: 100,
                headers,
              }),
            ),
          ]);
          bodies.push(
            ...[...comments, ...reviews]
              .filter((c) => c.user?.login === login && c.body)
              .map((c) => c.body),
          );
          if (bodies.length >= 200) break;
        }
        return bodies.slice(0, 200);
      }
    },
    getCheckRuns: (owner: string, repo: string, sha: string) =>
      read(`checks:${owner}/${repo}:${sha}`, (headers) =>
        octokit.rest.checks.listForRef({
          ...params(owner, repo),
          ref: sha,
          per_page: 100,
          headers,
        }),
      ),
    async submitReview(
      owner: string,
      repo: string,
      n: number,
      data: {
        commit_id: string;
        event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
        body: string;
        comments: ReviewComment[];
      },
    ) {
      const files = await listPullFiles(owner, repo, n, true);
      const normalized = normalizeComments(files.files, data.body, data.comments);
      if (normalized.body.length > 65000) throw new GitHubError('validation', 422);
      const pull = await getPull(owner, repo, n, true);
      if (pull.head.sha !== data.commit_id) throw new GitHubError('stale_head', 409);
      return request(async () => {
        const response = await octokit.rest.pulls.createReview({
          ...params(owner, repo),
          pull_number: n,
          commit_id: data.commit_id,
          event: data.event,
          body: normalized.body,
          comments: normalized.comments.map((c) => ({
            path: c.path,
            line: c.line,
            side: c.side,
            body: c.body,
            ...(c.startLine && c.startLine < c.line
              ? { start_line: c.startLine, start_side: c.side }
              : {}),
          })),
          request: { retries: 0 },
        });
        return { url: response.data.html_url, number: response.data.id };
      });
    },
    getViewer: () => read('viewer', (headers) => octokit.rest.users.getAuthenticated({ headers })),
    searchRepos: (q: string, page = 1) =>
      read(`search:${q}:${page}`, (headers) =>
        octokit.rest.search.repos({ q, page, per_page: 20, headers }),
      ),
    getRepo: (owner: string, repo: string, fresh = false) =>
      read(
        `repo:${owner}/${repo}`,
        (headers) => octokit.rest.repos.get({ ...params(owner, repo), headers }),
        fresh,
      ),
    async getReadme(owner: string, repo: string) {
      try {
        const result = await read(`readme:${owner}/${repo}`, (headers) =>
          octokit.rest.repos.getReadme({ ...params(owner, repo), headers }),
        );
        return { body: Buffer.from(result.content, 'base64').toString('utf8'), path: result.path };
      } catch (error) {
        if (error instanceof GitHubError && error.code === 'not_found')
          return { body: '', path: 'README.md' };
        throw error;
      }
    },
    async getContributing(owner: string, repo: string) {
      for (const path of ['CONTRIBUTING.md', '.github/CONTRIBUTING.md', 'docs/CONTRIBUTING.md']) {
        const body = await optionalFile(owner, repo, path);
        if (body !== null) return { body, path };
      }
      return { body: '', path: 'CONTRIBUTING.md' };
    },
    async listIssueTemplates(owner: string, repo: string) {
      let files;
      try {
        files = await read(`templates:${owner}/${repo}`, (headers) =>
          octokit.rest.repos.getContent({
            ...params(owner, repo),
            path: '.github/ISSUE_TEMPLATE',
            headers,
          }),
        );
      } catch (error) {
        if (error instanceof GitHubError && error.code === 'not_found')
          return { templates: [], blankIssuesEnabled: true, warnings: [] as string[] };
        throw error;
      }
      const templates: IssueTemplate[] = [];
      const warnings: string[] = [];
      let blankIssuesEnabled = true;
      if (Array.isArray(files)) {
        for (const file of files
          .filter((f) => f.type === 'file' && /\.(md|ya?ml)$/i.test(f.name))
          .slice(0, 50)) {
          const text = await getFileContent(owner, repo, file.path);
          if (text === null) continue;
          try {
            if (/^config\.ya?ml$/i.test(file.name))
              blankIssuesEnabled = parseTemplateConfig(text).blankIssuesEnabled;
            else {
              const template = parseTemplate(file.name, text);
              if (template) templates.push(template);
            }
          } catch {
            warnings.push(file.name);
            if (/^config\.ya?ml$/i.test(file.name)) blankIssuesEnabled = false;
          }
        }
      }
      return { templates, blankIssuesEnabled, warnings };
    },
    async listIssues(owner: string, repo: string, state: 'open' | 'closed' = 'open', page = 1) {
      const items = await read(`issues:${owner}/${repo}:${state}:${page}`, (headers) =>
        octokit.rest.issues.listForRepo({
          ...params(owner, repo),
          state,
          page,
          per_page: 20,
          headers,
        }),
      );
      return { items: items.filter((item) => !item.pull_request), hasMore: items.length === 20 };
    },
    searchIssues: (q: string, page = 1, sort?: 'updated') =>
      read(`issues-search:${q}:${page}:${sort ?? ''}`, (headers) =>
        octokit.rest.search.issuesAndPullRequests({
          q,
          page,
          per_page: 20,
          headers,
          sort,
          order: 'desc',
        }),
      ),
    createIssue: (
      owner: string,
      repo: string,
      data: { title: string; body: string; labels?: string[] },
    ) =>
      request(async () => {
        const response = await octokit.rest.issues.create({
          ...params(owner, repo),
          ...data,
          request: { retries: 0 },
        });
        return { url: response.data.html_url, number: response.data.number };
      }),
    async listPulls(owner: string, repo: string, state: 'open' | 'closed' = 'open', page = 1) {
      const items = await read(`pulls:${owner}/${repo}:${state}:${page}`, (headers) =>
        octokit.rest.pulls.list({ ...params(owner, repo), state, page, per_page: 20, headers }),
      );
      return { items, hasMore: items.length === 20 };
    },
    getFileContent,
  };
}
export type GitHubClient = ReturnType<typeof createGitHubClient>;
