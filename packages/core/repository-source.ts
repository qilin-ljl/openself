import { AppError } from '@openself/shared/errors';
import type { GitHubClient } from '@openself/github';
import type { RunContext } from './ai-context';
import { sourceSkipReason } from './contribution-policy';
export type Entry = { path: string; sha: string; mode: string; size: number };
export async function publicRepository(ctx: RunContext, name: string) {
  const [owner, repo] = name.split('/') as [string, string];
  const github = await ctx.workspace.githubFor(ctx.user.id);
  const info = await github.getRepo(owner, repo, true);
  if (info.private) throw new AppError('scan_public_only', 403);
  if (info.archived) throw new AppError('repository_archived', 409);
  return { owner, repo, github, info };
}
export async function snapshot(github: GitHubClient, owner: string, repo: string, sha: string) {
  const commit = await github.getGitCommit(owner, repo, sha);
  const result = await github.getGitTree(owner, repo, commit.tree.sha);
  const entries: Entry[] = [];
  for (const entry of result.tree)
    if (entry.type === 'blob' && entry.path && entry.sha && entry.mode)
      entries.push({ path: entry.path, sha: entry.sha, mode: entry.mode, size: entry.size ?? 0 });
  return { entries, allEntries: result.tree, truncated: !!result.truncated };
}
export async function readSource(github: GitHubClient, owner: string, repo: string, entry: Entry) {
  const excluded = sourceSkipReason(entry);
  if (excluded) throw new AppError(excluded, 400);
  const blob = await github.getGitBlob(owner, repo, entry.sha);
  if (blob.encoding !== 'base64' || (blob.size ?? 0) > 200000)
    throw new AppError('unsupported_source', 400);
  const bytes = Buffer.from(blob.content, 'base64');
  if (bytes.length > 200000) throw new AppError('too_large', 400);
  let body: string;
  try {
    body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new AppError('unsupported_source', 400);
  }
  const reason = sourceSkipReason(entry, body);
  if (reason) throw new AppError(reason, 400);
  return body;
}
export const sourceUrl = (repo: string, sha: string, path: string, line: number) =>
  'https://github.com/' +
  repo +
  '/blob/' +
  sha +
  '/' +
  path.split('/').map(encodeURIComponent).join('/') +
  '#L' +
  line;
