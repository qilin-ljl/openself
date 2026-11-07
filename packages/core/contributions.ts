import { AppError } from '@openself/shared/errors';
import {
  IdeaInput,
  IdeaQueries,
  RankedProjects,
  DiscoveryResult,
  RepositoryScanResult,
  ModelCodeEdits,
  PreparedChange,
} from '@openself/shared/contributions';
import { SAFETY, untrusted } from '@openself/llm/prompts';
import type { RunContext } from './ai-context';
import type { GitHubClient } from '@openself/github';
import type { Entry } from './repository-source';
import { selectChangeContext } from './change-context';
import { assertContributionPath, applySourceEdits, sourceSkipReason } from './contribution-policy';

import { publicRepository, snapshot, readSource } from './repository-source';
export { planRepository, scanRepository } from './repository-analysis';
const language = (ctx: RunContext) =>
  ctx.lang === 'zh' ? 'Write explanations in Chinese.' : 'Write explanations in English.';
export async function discoverProjects(ctx: RunContext, input: unknown): Promise<DiscoveryResult> {
  const { idea } = IdeaInput.parse(input),
    github = await ctx.workspace.githubFor(ctx.user.id);
  const queries = (
    await ctx.provider.completeJSON({
      tier: 'fast',
      system:
        '[TASK:ideaQueries] ' +
        SAFETY +
        ' Turn the supplied idea into one to three short GitHub repository search queries, each 1–160 characters, using relevant keywords and optional language qualifiers. Return {"queries":["..."]}.',
      user: untrusted({ idea }),
      schema: IdeaQueries,
    })
  ).data.queries;
  const candidates = new Map<
    string,
    Awaited<ReturnType<GitHubClient['searchRepos']>>['items'][number]
  >();
  for (const query of queries) {
    const results = await github.searchRepos(query + ' is:public archived:false');
    for (const repo of results.items)
      if (!repo.private && !repo.archived) candidates.set(repo.full_name.toLowerCase(), repo);
  }
  const sources: { repo: Awaited<ReturnType<GitHubClient['getRepo']>>; readme: string }[] = [];
  for (const item of [...candidates.values()].slice(0, 8)) {
    const [owner, repo] = item.full_name.split('/') as [string, string];
    const fresh = await github.getRepo(owner, repo, true);
    if (fresh.private || fresh.archived) continue;
    const readme = (await github.getReadme(owner, repo)).body.slice(0, 6000);
    sources.push({
      repo: fresh,
      readme: sourceSkipReason({ path: 'README.md' }, readme) ? '' : readme,
    });
  }
  if (!sources.length) return { idea, queries, examined: 0, projects: [] };
  const ranked = (
    await ctx.provider.completeJSON({
      tier: 'fast',
      system:
        '[TASK:rankProjects] ' +
        SAFETY +
        ' ' +
        language(ctx) +
        ' Rank only the supplied real repositories for the idea. Return at most six projects, even if more candidates are supplied; an empty array is valid. Each project must have a repo in owner/name format (not a URL), a reason of at most 2000 characters, and at most three directions, each at most 1000 characters. Explain the evidence from descriptions/readmes and suggest contribution directions as hypotheses, not confirmed bugs or claims that an undocumented feature is absent. Do not invent projects or metrics. Return {"projects":[{"repo":"owner/name","reason":"...","directions":["..."]}]}.',
      user: untrusted({
        idea,
        projects: sources.map(({ repo, readme }) => ({
          repo: repo.full_name,
          description: repo.description,
          language: repo.language,
          updatedAt: repo.updated_at,
          stars: repo.stargazers_count,
          readme,
        })),
      }),
      schema: RankedProjects,
    })
  ).data;
  const seen = new Set<string>();
  return DiscoveryResult.parse({
    idea,
    queries,
    examined: sources.length,
    projects: ranked.projects.flatMap((item) => {
      const found = sources.find((source) => source.repo.full_name.toLowerCase() === item.repo);
      if (!found || seen.has(item.repo)) return [];
      seen.add(item.repo);
      return [
        {
          repo: item.repo,
          url: 'https://github.com/' + item.repo,
          reason: item.reason,
          directions: item.directions,
          description: found.repo.description,
          language: found.repo.language,
          stars: found.repo.stargazers_count,
          updatedAt: found.repo.updated_at,
        },
      ];
    }),
  });
}

export async function prepareCodeChange(
  ctx: RunContext,
  scan: RepositoryScanResult,
  findingId: string,
  instruction: string,
  scanJobId: string,
): Promise<PreparedChange> {
  const finding = scan.findings.find((item) => item.id === findingId);
  if (!finding) throw new AppError('not_found', 404);
  if (scan.treeTruncated) throw new AppError('repository_tree_incomplete', 409);
  const { owner, repo, github, info } = await publicRepository(ctx, scan.repo);
  if (
    info.id !== scan.repoId ||
    info.default_branch !== scan.baseBranch ||
    (await github.getBranchSha(owner, repo, scan.baseBranch)) !== scan.baseSha
  )
    throw new AppError('stale_repository', 409);
  const tree = await snapshot(github, owner, repo, scan.baseSha);
  if (tree.truncated) throw new AppError('repository_tree_incomplete', 409);
  const target = tree.entries.find((entry) => entry.path === finding.path);
  if (!target) throw new AppError('not_found', 404);
  const targetBody = await readSource(github, owner, repo, target);
  const related = selectChangeContext(
    tree.entries,
    target,
    [finding.title, finding.explanation, finding.suggestion, instruction, targetBody].join('\n'),
  );
  const originals = new Map<string, { entry: Entry; body: string; excerpt: string }>();
  const unavailableFiles: { path: string; reason: string }[] = [];
  for (const entry of related) {
    let body: string;
    try {
      body = entry.path === target.path ? targetBody : await readSource(github, owner, repo, entry);
    } catch (error) {
      if (
        entry.path === target.path ||
        (error instanceof AppError &&
          ['unauthorized', 'forbidden', 'rate_limited'].includes(error.code))
      )
        throw error;
      unavailableFiles.push({
        path: entry.path,
        reason: error instanceof AppError ? error.code : 'read_failed',
      });
      continue;
    }
    const lines = body.replaceAll('\r\n', '\n').split('\n');
    const start = entry.path === target.path ? Math.max(0, finding.line - 80) : 0;
    const excerpt = lines
      .slice(start, start + 180)
      .join('\n')
      .slice(0, 16000);
    originals.set(entry.path, { entry, body, excerpt });
  }
  const contextFiles = [...originals.keys()];
  await ctx.onProgress?.({
    changeContext: { repo: scan.repo, scanJobId, findingId, files: contextFiles, unavailableFiles },
    changeDiagnostic: null,
  });
  const proposal = (
    await ctx.provider.completeJSON({
      tier: 'deep',
      system:
        '[TASK:codeChanges] ' +
        SAFETY +
        ' ' +
        language(ctx) +
        ' Prepare a minimal code change for the selected candidate after checking it against the source. Never claim tests passed or ran. You cannot execute code. Edit only supplied source files with exact, unique original/replacement snippets copied from their supplied excerpts; new source/test files are allowed. Dependency manifests and project configuration may be edited when needed for the selected request. Do not re-add settings already present in the supplied files. Use dependency versions evidenced in the supplied context or user instruction; if a required version cannot be established, explain that missing information rather than inventing a version. Do not modify credentials, git metadata, workflows, generated lockfiles, or delete files. Merely inspecting files is not installing or executing dependencies. Return {"title":"...","body":"why and what changes","verification":["suggested checks, not executed"],"changes":[{"path":"src.ts","action":"edit","edits":[{"original":"exact original code","replacement":"new code"}]}]}. For action create, provide content and an empty edits array. At most five files. If the change is already implemented, cannot be supported, or needs missing context, return an empty changes array and explain the specific reason and the information needed in body. Do not produce an empty or irrelevant patch just to create a PR.',
      user: untrusted({
        repo: scan.repo,
        finding,
        instruction,
        goal: scan.goal,
        baseSha: scan.baseSha,
        unavailableFiles,
        paths: tree.entries.map((entry) => entry.path).slice(0, 500),
        files: [...originals].map(([path, source]) => ({ path, excerpt: source.excerpt })),
      }),
      schema: ModelCodeEdits,
    })
  ).data;
  const explain = async (code: string) => {
    const reason = proposal.body.trim().slice(0, 4000) || proposal.title;
    await ctx.onProgress?.({
      changeDiagnostic: {
        code,
        reason: sourceSkipReason({ path: 'explanation.md' }, reason) ? '' : reason,
        files: contextFiles,
      },
    });
  };
  if (!proposal.changes.length) {
    await explain('patch_no_changes');
    throw new AppError('patch_no_changes', 409);
  }
  try {
    const files: PreparedChange['files'] = [],
      seen = new Set<string>();
    for (const change of proposal.changes) {
      assertContributionPath(change.path);
      if (seen.has(change.path)) throw new AppError('patch_duplicate_path', 400);
      seen.add(change.path);
      if (change.action === 'create') {
        if (
          tree.allEntries.some(
            (entry) =>
              entry.path === change.path ||
              (entry.path && entry.type !== 'tree' && change.path.startsWith(entry.path + '/')),
          ) ||
          typeof change.content !== 'string'
        )
          throw new AppError('patch_context_mismatch', 409);
        if (
          sourceSkipReason(
            { path: change.path, mode: '100644', size: Buffer.byteLength(change.content) },
            change.content,
          )
        )
          throw new AppError('protected_path', 400);
        files.push({
          path: change.path,
          action: 'create',
          before: '',
          after: change.content,
          blobSha: null,
          mode: '100644',
        });
      } else {
        const source = originals.get(change.path);
        if (
          !source ||
          change.edits.some(
            (edit) => !source.excerpt.includes(edit.original.replaceAll('\r\n', '\n')),
          )
        )
          throw new AppError('patch_context_mismatch', 409);
        if (!change.edits.length) throw new AppError('patch_empty_edits', 400);
        const after = applySourceEdits(source.body, change.edits);
        if (after === source.body) continue;
        if (Buffer.byteLength(after) > 200000) throw new AppError('patch_too_large', 400);
        files.push({
          path: change.path,
          action: 'edit',
          before: source.body,
          after,
          blobSha: source.entry.sha,
          mode: source.entry.mode as '100644' | '100755',
        });
      }
    }
    if (!files.length) throw new AppError('patch_no_effect', 409);
    if (files.reduce((sum, file) => sum + file.after.length, 0) > 400000)
      throw new AppError('patch_too_large', 400);
    const notice =
      ctx.lang === 'zh'
        ? '\n\n## 验证状态\nOpenSelf 未执行目标仓库的代码或测试。以下为建议验证步骤，不能视为已通过：\n'
        : '\n\n## Verification status\nOpenSelf did not execute the target repository code or tests. Suggested checks below have not been run:\n';
    return PreparedChange.parse({
      repo: scan.repo,
      repoId: scan.repoId,
      baseBranch: scan.baseBranch,
      baseSha: scan.baseSha,
      scanJobId,
      findingId,
      title: proposal.title,
      body:
        proposal.body +
        notice +
        proposal.verification.map((step) => '- ' + step).join('\n') +
        '\n\n' +
        finding.sourceUrl,
      verification: proposal.verification,
      testsExecuted: false,
      files,
    });
  } catch (error) {
    if (error instanceof AppError) await explain(error.code);
    throw error;
  }
}
