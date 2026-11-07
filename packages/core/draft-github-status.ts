import type { DraftGitHubStatus } from '@openself/shared/api';
import { AppError } from '@openself/shared/errors';
import { and, eq, inArray, schema, type Database } from '@openself/db';
import type { Workspace } from './workspace';
import type { Draft, User } from './drafts';

function target(draft: Draft) {
  if (!draft.githubUrl) throw new AppError('not_found', 404);
  const url = new URL(draft.githubUrl);
  const match = /^\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)\/?$/.exec(url.pathname);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.username ||
    url.password ||
    !match ||
    (match[1] + '/' + match[2]).toLowerCase() !== draft.repoFullName.toLowerCase() ||
    match[3] !== (draft.kind === 'issue' ? 'issues' : 'pull')
  )
    throw new AppError('validation', 400);
  const number = Number(match[4]);
  if (!Number.isSafeInteger(number) || number < 1) throw new AppError('validation', 400);
  if (draft.kind === 'review' && draft.targetNumber !== number)
    throw new AppError('validation', 400);
  return { owner: match[1]!, repo: match[2]!, number };
}
export async function readDraftGitHubStatuses(
  db: Database,
  workspace: Workspace,
  user: User,
  ids: string[],
) {
  const drafts = await db
    .select()
    .from(schema.drafts)
    .where(
      and(
        eq(schema.drafts.userId, user.id),
        eq(schema.drafts.status, 'published'),
        inArray(schema.drafts.id, ids),
      ),
    );
  const github = await workspace.githubFor(user.id);
  const repositories = new Map<string, Promise<void>>();
  function accessible(owner: string, repo: string) {
    const key = (owner + '/' + repo).toLowerCase();
    let check = repositories.get(key);
    if (!check) {
      check = (async () => {
        const info = await github.getRepo(owner, repo, true);
        if (info.private && !user.privateRepoEnabled)
          throw new AppError('private_repo_disabled', 403);
      })();
      repositories.set(key, check);
    }
    return check;
  }
  const output = new Map<string, DraftGitHubStatus>();
  let cursor = 0;
  async function worker() {
    for (;;) {
      const draft = drafts[cursor++];
      if (!draft) return;
      const item: DraftGitHubStatus = {
        draftId: draft.id,
        kind: draft.kind === 'issue' ? 'issue' : 'pull_request',
        state: 'unavailable',
        checkedAt: new Date().toISOString(),
      };
      try {
        const { owner, repo, number } = target(draft);
        item.number = number;
        await accessible(owner, repo);
        if (draft.kind === 'issue') {
          const issue = await github.getIssue(owner, repo, number);
          if (issue.pull_request) throw new AppError('validation', 409);
          item.state = issue.state === 'closed' ? 'closed' : 'open';
        } else {
          const pull = await github.getPull(owner, repo, number, true);
          item.state = pull.merged
            ? 'merged'
            : pull.state === 'closed'
              ? 'closed'
              : pull.draft
                ? 'draft'
                : 'open';
        }
      } catch (error) {
        item.error = error instanceof AppError ? error.code : 'service_unavailable';
      }
      item.checkedAt = new Date().toISOString();
      output.set(draft.id, item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, drafts.length) }, worker));
  return { items: drafts.map((draft) => output.get(draft.id)!) };
}
