import { randomUUID } from 'node:crypto';
import { AppError } from '@openself/shared/errors';
import {
  IdeaInput,
  IdeaQueries,
  RankedProjects,
  DiscoveryResult,
  RepositoryScanInput,
  ScanBatch,
  RepositoryScanResult,
  ModelCodeEdits,
  PreparedChange,
} from '@openself/shared/contributions';
import { SAFETY, untrusted } from '@openself/llm/prompts';
import type { GitHubClient } from '@openself/github';
import type { RunContext } from './ai-context';
import {
  assertContributionPath,
  applySourceEdits,
  matchesEvidence,
  sourceSkipReason,
} from './contribution-policy';

type Entry = { path: string; sha: string; mode: string; size: number };
async function publicRepository(ctx: RunContext, name: string) {
  const [owner, repo] = name.split('/') as [string, string];
  const github = await ctx.workspace.githubFor(ctx.user.id);
  const info = await github.getRepo(owner, repo, true);
  if (info.private) throw new AppError('scan_public_only', 403);
  if (info.archived) throw new AppError('repository_archived', 409);
  return { owner, repo, github, info };
}
async function snapshot(github: GitHubClient, owner: string, repo: string, sha: string) {
  const commit = await github.getGitCommit(owner, repo, sha);
  const result = await github.getGitTree(owner, repo, commit.tree.sha);
  const entries: Entry[] = [];
  for (const entry of result.tree)
    if (entry.type === 'blob' && entry.path && entry.sha && entry.mode)
      entries.push({ path: entry.path, sha: entry.sha, mode: entry.mode, size: entry.size ?? 0 });
  return { entries, allEntries: result.tree, truncated: !!result.truncated };
}
async function readSource(github: GitHubClient, owner: string, repo: string, entry: Entry) {
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
const language = (ctx: RunContext) =>
  ctx.lang === 'zh' ? 'Write explanations in Chinese.' : 'Write explanations in English.';
const sourceUrl = (repo: string, sha: string, path: string, line: number) =>
  'https://github.com/' +
  repo +
  '/blob/' +
  sha +
  '/' +
  path.split('/').map(encodeURIComponent).join('/') +
  '#L' +
  line;

export async function discoverProjects(ctx: RunContext, input: unknown): Promise<DiscoveryResult> {
  const { idea } = IdeaInput.parse(input),
    github = await ctx.workspace.githubFor(ctx.user.id);
  const queries = (
    await ctx.provider.completeJSON({
      tier: 'fast',
      system:
        '[TASK:ideaQueries] ' +
        SAFETY +
        ' Turn the supplied idea into up to three short GitHub repository search queries, using relevant keywords and optional language qualifiers. Return {"queries":["..."]}.',
      user: untrusted({ idea }),
      schema: IdeaQueries,
      maxTokens: 900,
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
        ' Rank only the supplied real repositories for the idea. Explain the evidence from descriptions/readmes and suggest contribution directions as hypotheses, not confirmed bugs or claims that an undocumented feature is absent. Do not invent projects or metrics. Return {"projects":[{"repo":"owner/name","reason":"...","directions":["..."]}]}.',
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
      maxTokens: 4500,
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

export async function scanRepository(
  ctx: RunContext,
  input: unknown,
): Promise<RepositoryScanResult> {
  const parsed = RepositoryScanInput.parse(input);
  const { owner, repo, github, info } = await publicRepository(ctx, parsed.repo);
  const baseSha = await github.getBranchSha(owner, repo, info.default_branch);
  const tree = await snapshot(github, owner, repo, baseSha);
  const skipped: { path: string; reason: string }[] = [],
    eligible: Entry[] = [];
  for (const entry of tree.entries) {
    const reason = sourceSkipReason(entry);
    if (reason) skipped.push({ path: entry.path, reason });
    else eligible.push(entry);
  }
  const score = (entry: Entry) =>
    /^(?:src|app|lib|backend|server|frontend\/src)\//.test(entry.path)
      ? 0
      : /(?:test|spec)/i.test(entry.path)
        ? 2
        : 1;
  eligible.sort((a, b) => score(a) - score(b) || a.size - b.size || a.path.localeCompare(b.path));
  const sources: {
    entry: Entry;
    body: string;
    lines: number;
    totalLines: number;
    partial: boolean;
  }[] = [];
  let examinedCharacters = 0;
  for (const entry of eligible) {
    if (sources.length >= parsed.maxFiles || examinedCharacters >= 160000) {
      skipped.push({ path: entry.path, reason: 'scan_budget' });
      continue;
    }
    try {
      const complete = (await readSource(github, owner, repo, entry)).replaceAll('\r\n', '\n');
      const allLines = complete.split('\n');
      let excerpt = allLines.slice(0, 400).join('\n');
      const remaining = Math.min(16000, 160000 - examinedCharacters);
      if (excerpt.length > remaining) {
        const boundary = excerpt.lastIndexOf('\n', remaining);
        if (boundary <= 0) {
          skipped.push({ path: entry.path, reason: 'long_line' });
          continue;
        }
        excerpt = excerpt.slice(0, boundary);
      }
      if (!excerpt.trim()) {
        skipped.push({ path: entry.path, reason: 'empty' });
        continue;
      }
      sources.push({
        entry,
        body: excerpt,
        lines: excerpt.split('\n').length,
        totalLines: allLines.length,
        partial: excerpt.length < complete.length,
      });
      examinedCharacters += excerpt.length;
    } catch (error) {
      if (
        error instanceof AppError &&
        ['unauthorized', 'rate_limited', 'forbidden'].includes(error.code)
      )
        throw error;
      skipped.push({
        path: entry.path,
        reason: error instanceof AppError ? error.code : 'read_failed',
      });
    }
  }
  let issues: { number: number; title: string; url: string }[] = [];
  try {
    issues = (await github.listIssues(owner, repo)).items.slice(0, 20).map((item) => ({
      number: item.number,
      title: item.title,
      url: item.html_url,
    }));
  } catch {
    /* Scanning remains usable when issue discussion cannot be read. */
  }
  const findings: RepositoryScanResult['findings'] = [],
    seen = new Set<string>();
  let invalidFindings = 0;
  for (let offset = 0; offset < sources.length; offset += 2) {
    const batch = sources.slice(offset, offset + 2);
    const result = await ctx.provider.completeJSON({
      tier: 'deep',
      system:
        '[TASK:repositoryScan] ' +
        SAFETY +
        ' ' +
        language(ctx) +
        ' Inspect the supplied code for concrete candidate bugs or useful improvements. These are static-analysis candidates; no code or tests were executed. Return only findings supported by the exact supplied code. Each finding must use an existing path and absolute line number, and evidence copied exactly from that line without the line-number prefix. Do not report issues merely because code was truncated. relatedIssues must reference supplied issue numbers. Return {"findings":[{"path":"src.ts","line":2,"kind":"bug","title":"...","explanation":"...","evidence":"exact code","suggestion":"...","verification":["steps to verify"],"confidence":0.9,"relatedIssues":[]}]}; kind is bug, improvement, tests or docs. Empty findings are valid.',
      user: untrusted({
        repo: parsed.repo,
        goal: parsed.goal,
        baseSha,
        recentIssues: issues,
        files: batch.map((file) => ({
          path: file.entry.path,
          partial: file.partial,
          code: file.body
            .split('\n')
            .map((line, index) => index + 1 + ': ' + line)
            .join('\n'),
        })),
      }),
      schema: ScanBatch,
      maxTokens: 8000,
    });
    for (const finding of result.data.findings) {
      const source = batch.find((file) => file.entry.path === finding.path);
      if (
        !source ||
        finding.confidence < 0.65 ||
        !matchesEvidence(source.body, finding.line, finding.evidence)
      ) {
        invalidFindings++;
        continue;
      }
      const key = finding.path + ':' + finding.line + ':' + finding.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        ...finding,
        id: randomUUID(),
        relatedIssues: [
          ...new Set(
            finding.relatedIssues.filter((number) =>
              issues.some((issue) => issue.number === number),
            ),
          ),
        ],
        sourceUrl: sourceUrl(parsed.repo, baseSha, finding.path, finding.line),
      });
      if (findings.length >= 30) break;
    }
    if (findings.length >= 30) {
      for (const file of sources.slice(offset + 2))
        skipped.push({ path: file.entry.path, reason: 'finding_budget' });
      sources.splice(offset + 2);
      break;
    }
  }
  return RepositoryScanResult.parse({
    repo: parsed.repo,
    repoId: info.id,
    goal: parsed.goal,
    baseBranch: info.default_branch,
    baseSha,
    treeTruncated: tree.truncated,
    eligibleFiles: eligible.length,
    examinedFiles: sources.length,
    examinedCharacters: sources.reduce((sum, file) => sum + file.body.length, 0),
    scanned: sources.map((file) => ({
      path: file.entry.path,
      lines: file.lines,
      totalLines: file.totalLines,
      partial: file.partial,
    })),
    skipped: skipped.slice(0, 200),
    skippedCount: skipped.length,
    findings,
    invalidFindings,
    relatedIssues: issues,
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
  const stem = finding.path.split('/').at(-1)!.split('.')[0]!;
  const nearby = tree.entries
    .filter(
      (entry) =>
        entry.path !== target.path &&
        !sourceSkipReason(entry) &&
        (entry.path.includes(stem) ||
          ['package.json', 'pyproject.toml', 'README.md'].includes(entry.path)),
    )
    .slice(0, 3);
  const originals = new Map<string, { entry: Entry; body: string; excerpt: string }>();
  for (const entry of [target, ...nearby]) {
    const body = await readSource(github, owner, repo, entry);
    const lines = body.replaceAll('\r\n', '\n').split('\n');
    const start = entry.path === target.path ? Math.max(0, finding.line - 80) : 0;
    const excerpt = lines
      .slice(start, start + 180)
      .join('\n')
      .slice(0, 16000);
    originals.set(entry.path, { entry, body, excerpt });
  }
  const proposal = (
    await ctx.provider.completeJSON({
      tier: 'deep',
      system:
        '[TASK:codeChanges] ' +
        SAFETY +
        ' ' +
        language(ctx) +
        ' Prepare a minimal code change for the selected candidate after checking it against the source. Never claim tests passed or ran. You cannot execute code. Edit only supplied source files with exact, unique original/replacement snippets copied from their supplied excerpts; new source/test files are allowed. Do not modify credentials, git metadata, workflows, dependencies, or delete files. Return {"title":"...","body":"why and what changes","verification":["suggested checks, not executed"],"changes":[{"path":"src.ts","action":"edit","edits":[{"original":"exact original code","replacement":"new code"}]}]}. For action create, provide content and an empty edits array. At most five files. If the candidate cannot be supported, explain why and return no changes.',
      user: untrusted({
        repo: scan.repo,
        finding,
        instruction,
        goal: scan.goal,
        baseSha: scan.baseSha,
        paths: tree.entries.map((entry) => entry.path).slice(0, 500),
        files: [...originals].map(([path, source]) => ({ path, excerpt: source.excerpt })),
      }),
      schema: ModelCodeEdits,
      maxTokens: 14000,
    })
  ).data;
  const files: PreparedChange['files'] = [],
    seen = new Set<string>();
  for (const change of proposal.changes) {
    assertContributionPath(change.path);
    if (seen.has(change.path)) throw new AppError('patch_invalid', 400);
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
      const after = applySourceEdits(source.body, change.edits);
      if (after === source.body) continue;
      if (Buffer.byteLength(after) > 200000) throw new AppError('patch_invalid', 400);
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
  if (!files.length || files.reduce((sum, file) => sum + file.after.length, 0) > 400000)
    throw new AppError('patch_invalid', 400);
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
}
