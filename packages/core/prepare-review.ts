import { ReviewPayload } from '@openself/shared/api';
import { AppError } from '@openself/shared/errors';
import type { GitHubClient } from '@openself/github';
import { normalizeComments } from '@openself/github/review';
export async function prepareReview(
  github: GitHubClient,
  user: { login: string; privateRepoEnabled: boolean },
  repoFullName: string,
  n: number,
  payload: ReviewPayload,
) {
  const [owner, repo] = repoFullName.split('/') as [string, string];
  const repository = await github.getRepo(owner, repo, true);
  if (repository.private && !user.privateRepoEnabled)
    throw new AppError('private_repo_disabled', 403);
  if (repository.archived) throw new AppError('repository_archived', 409);
  const pull = await github.getPull(owner, repo, n, true);
  if (pull.head.sha !== payload.headSha) throw new AppError('stale_head', 409);
  if (pull.user?.login.toLowerCase() === user.login.toLowerCase() && payload.event !== 'COMMENT')
    throw new AppError('self_review', 403);
  const { files } = await github.listPullFiles(owner, repo, n, true);
  const normalized = normalizeComments(files, payload.body, payload.comments);
  return ReviewPayload.parse({ ...payload, title: pull.title.slice(0, 200), ...normalized });
}
