import { setTimeout as delay } from 'node:timers/promises';
import { eq, and, schema, type Database } from '@openself/db';
import { AppError } from '@openself/shared/errors';
import {
  PreparedChange,
  PullRequestDraftInput,
  PullRequestPayload,
} from '@openself/shared/contributions';
import type { GitHubClient } from '@openself/github';
import type { User } from './drafts';
import { assertContributionPath, sourceSkipReason } from './contribution-policy';

export async function preparePullRequestPayload(
  db: Database,
  user: User,
  repo: string,
  input: unknown,
) {
  const parsed = PullRequestDraftInput.parse(input);
  const [job] = await db
    .select()
    .from(schema.aiJobs)
    .where(and(eq(schema.aiJobs.id, parsed.changeJobId), eq(schema.aiJobs.userId, user.id)));
  if (!job) throw new AppError('not_found', 404);
  if (job.kind !== 'change.prepare' || job.status !== 'done')
    throw new AppError('change_not_ready', 409);
  const change = PreparedChange.parse(job.resultJson);
  if (change.repo !== repo.toLowerCase()) throw new AppError('not_found', 404);
  for (const file of change.files) assertContributionPath(file.path);
  return PullRequestPayload.parse({
    ...change,
    changeJobId: job.id,
    title: parsed.title ?? change.title,
    body: parsed.body ?? change.body,
    asDraft: parsed.asDraft,
    lang: user.locale,
    aiGenerated: true,
  });
}

export async function publishPreparedPullRequest(
  github: GitHubClient,
  user: Pick<User, 'login' | 'githubId'>,
  draftId: string,
  input: PullRequestPayload,
  onMutation: (phase: 'attempt' | 'confirmed') => void,
) {
  const payload = PullRequestPayload.parse(input);
  const [owner, repo] = payload.repo.split('/') as [string, string];
  const info = await github.getRepo(owner, repo, true);
  if (info.private) throw new AppError('scan_public_only', 403);
  if (info.archived) throw new AppError('repository_archived', 409);
  if (
    info.id !== payload.repoId ||
    info.default_branch !== payload.baseBranch ||
    (await github.getBranchSha(owner, repo, payload.baseBranch)) !== payload.baseSha
  )
    throw new AppError('stale_repository', 409);
  const base = await github.getGitCommit(owner, repo, payload.baseSha);
  const tree = await github.getGitTree(owner, repo, base.tree.sha);
  if (tree.truncated) throw new AppError('repository_tree_incomplete', 409);
  const seen = new Set<string>();
  for (const file of payload.files) {
    assertContributionPath(file.path);
    if (
      seen.has(file.path) ||
      sourceSkipReason(
        { path: file.path, mode: file.mode, size: Buffer.byteLength(file.after) },
        file.after,
      )
    )
      throw new AppError('protected_path', 400);
    seen.add(file.path);
    const existing = tree.tree.find((entry) => entry.path === file.path);
    if (file.action === 'edit') {
      if (
        !existing ||
        existing.type !== 'blob' ||
        existing.sha !== file.blobSha ||
        existing.mode !== file.mode ||
        file.before === file.after
      )
        throw new AppError('stale_repository', 409);
    } else if (
      existing ||
      file.blobSha !== null ||
      file.before !== '' ||
      tree.tree.some(
        (entry) => entry.path && entry.type !== 'tree' && file.path.startsWith(entry.path + '/'),
      )
    ) {
      throw new AppError('patch_context_mismatch', 409);
    }
  }
  const viewer = await github.getViewer();
  if (viewer.id !== user.githubId) throw new AppError('unauthorized', 401);
  const branch = 'codex/openself-' + draftId.replaceAll('-', '').slice(0, 16);
  if (!/^codex\/openself-[a-f0-9]{16}$/.test(branch) || branch === payload.baseBranch)
    throw new AppError('patch_invalid', 400);
  async function mutate<T>(action: () => Promise<T>) {
    onMutation('attempt');
    const result = await action();
    onMutation('confirmed');
    return result;
  }
  let targetOwner = owner,
    targetRepo = repo;
  if (!info.permissions?.push) {
    targetOwner = viewer.login;
    let fork: Awaited<ReturnType<GitHubClient['getRepo']>> | undefined;
    try {
      fork = await github.getRepo(targetOwner, repo, true);
    } catch (error) {
      if (!(error instanceof AppError && error.code === 'not_found')) throw error;
    }
    if (
      fork &&
      (!fork.fork ||
        fork.parent?.id !== info.id ||
        fork.owner.login.toLowerCase() !== viewer.login.toLowerCase())
    )
      throw new AppError('fork_conflict', 409);
    if (!fork) {
      const created = await mutate(() => github.createFork(owner, repo));
      if (created.owner.login.toLowerCase() !== viewer.login.toLowerCase())
        throw new AppError('fork_conflict', 409);
      targetOwner = created.owner.login;
      targetRepo = created.name;
    } else targetRepo = fork.name;
    const deadline = Date.now() + 60000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const current = await github.getRepo(targetOwner, targetRepo, true);
        if (!current.fork || current.parent?.id !== info.id || current.private)
          throw new AppError('fork_conflict', 409);
        await github.getGitCommit(targetOwner, targetRepo, payload.baseSha);
        ready = true;
        break;
      } catch (error) {
        if (!(
          error instanceof AppError &&
          (error.code === 'not_found' || (error.code === 'unknown' && error.status === 409))
        ))
          throw error;
        await delay(1500);
      }
    }
    if (!ready) throw new AppError('fork_not_ready', 409);
  }
  try {
    await github.getGitRef(targetOwner, targetRepo, branch);
    throw new AppError('contribution_branch_exists', 409);
  } catch (error) {
    if (!(error instanceof AppError && error.code === 'not_found')) throw error;
  }
  await mutate(() => github.createGitRef(targetOwner, targetRepo, branch, payload.baseSha));
  const entries: { path: string; mode: '100644' | '100755'; type: 'blob'; sha: string }[] = [];
  for (const file of payload.files) {
    const blobSha = await mutate(() => github.createGitBlob(targetOwner, targetRepo, file.after));
    entries.push({ path: file.path, mode: file.mode, type: 'blob', sha: blobSha });
  }
  const newTree = await mutate(() =>
    github.createGitTree(targetOwner, targetRepo, base.tree.sha, entries),
  );
  const commit = await mutate(() =>
    github.createGitCommit(targetOwner, targetRepo, payload.title, newTree, payload.baseSha),
  );
  await mutate(() => github.updateGitRef(targetOwner, targetRepo, branch, commit));
  if ((await github.getGitRef(targetOwner, targetRepo, branch)).object.sha !== commit)
    throw new AppError('contribution_branch_changed', 409);
  return mutate(() =>
    github.createPullRequest(owner, repo, {
      title: payload.title,
      body: payload.body,
      base: payload.baseBranch,
      head:
        targetOwner.toLowerCase() === owner.toLowerCase() &&
        targetRepo.toLowerCase() === repo.toLowerCase()
          ? branch
          : targetOwner + ':' + branch,
      draft: payload.asDraft,
    }),
  );
}
