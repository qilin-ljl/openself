import { createHash, randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { z } from '@openself/shared/api';
import { AppError } from '@openself/shared/errors';
import {
  RepositoryScanInput,
  RepositoryScanResult,
  RepositoryPlan,
  ScanBatch,
} from '@openself/shared/contributions';
import { SAFETY, untrusted } from '@openself/llm/prompts';
import type { RunContext } from './ai-context';
import { sourceSkipReason, matchesEvidence } from './contribution-policy';
import { publicRepository, snapshot, readSource, sourceUrl, type Entry } from './repository-source';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const language = (ctx: RunContext) =>
  ctx.lang === 'zh' ? 'Write explanations in Chinese.' : 'Write explanations in English.';
const cancelled = (ctx: RunContext) => {
  if (ctx.signal?.aborted) throw new AppError('job_cancelled', 409);
};
const documentPath = (path: string) =>
  /(?:^|\/)(?:readme|contributing|architecture|usage|getting.started|package\.json|pyproject\.toml|cargo\.toml|go\.mod|cmakelists\.txt)/i.test(
    path,
  );
const priority = (path: string) =>
  /(?:^|\/)(?:main|index|app|train|render|server|cli|setup)\.[^.]+$/.test(path)
    ? 0
    : documentPath(path)
      ? 1
      : 2;
function declarations(body: string) {
  return body
    .split('\n')
    .flatMap((line, index) =>
      /^\s{0,4}(?:(?:export|public|private|static|async|default)\s+)*(?:def |class |function |fn |func |interface |(?:const|let)\s+\w+\s*=.*=>)/.test(
        line,
      )
        ? [{ line: index + 1, text: line.trim().slice(0, 180) }]
        : [],
    )
    .slice(0, 100);
}
async function inventory(ctx: RunContext, name: string) {
  cancelled(ctx);
  const target = await publicRepository(ctx, name);
  const baseSha = await target.github.getBranchSha(
    target.owner,
    target.repo,
    target.info.default_branch,
  );
  const tree = await snapshot(target.github, target.owner, target.repo, baseSha);
  const eligible = tree.entries.filter((entry) => !sourceSkipReason(entry));
  return { ...target, baseSha, tree, eligible };
}
type Inventory = Awaited<ReturnType<typeof inventory>>;
async function documents(ctx: RunContext, inv: Inventory) {
  const docs: { path: string; body: string }[] = [];
  for (const entry of inv.eligible
    .filter((entry) => documentPath(entry.path))
    .sort((a, b) => a.path.length - b.path.length)
    .slice(0, 8)) {
    cancelled(ctx);
    try {
      docs.push({
        path: entry.path,
        body: (await readSource(inv.github, inv.owner, inv.repo, entry)).slice(0, 7000),
      });
    } catch (error) {
      if (
        error instanceof AppError &&
        ['unauthorized', 'forbidden', 'rate_limited'].includes(error.code)
      )
        throw error;
    }
  }
  return docs;
}
const ModelPlan = z.object({
  summary: z.string().max(5000),
  modules: z
    .array(
      z.object({
        name: z.string().max(150),
        purpose: z.string().max(1200),
        paths: z.array(z.string().max(400)).max(20),
      }),
    )
    .max(20),
  files: z
    .array(
      z.object({
        path: z.string().max(400),
        reason: z.string().max(1200),
        role: z.string().max(200),
        focusLines: z.array(z.number().int().positive()).max(8).default([]),
      }),
    )
    .max(100),
});
async function buildPlan(
  ctx: RunContext,
  parsed: z.infer<typeof RepositoryScanInput>,
  inv: Inventory,
) {
  await ctx.onProgress?.({ progress: { stage: 'planning' } });
  const docs = await documents(ctx, inv);
  // A bounded directory manifest and symbol outlines guide the model; neither is executed.
  const ranked = [...inv.eligible].sort(
    (a, b) => priority(a.path) - priority(b.path) || a.path.localeCompare(b.path),
  );
  const manifest: { path: string; size: number }[] = [];
  let manifestSize = 0;
  for (const entry of ranked) {
    if (manifest.length >= 1200 || manifestSize + entry.path.length > 60000) break;
    manifest.push({ path: entry.path, size: entry.size });
    manifestSize += entry.path.length;
  }
  const outlines: { path: string; symbols: ReturnType<typeof declarations> }[] = [];
  // Sample entry points and different directories, not just the shortest source files.
  const groups = new Set<string>();
  const candidates = ranked
    .filter((entry) => !documentPath(entry.path))
    .filter((entry) => {
      const group = entry.path.split('/').slice(0, 2).join('/');
      if (priority(entry.path) === 0) return true;
      if (groups.has(group)) return false;
      groups.add(group);
      return true;
    })
    .slice(0, 24);
  for (const entry of candidates) {
    cancelled(ctx);
    try {
      outlines.push({
        path: entry.path,
        symbols: declarations(await readSource(inv.github, inv.owner, inv.repo, entry)),
      });
    } catch (error) {
      if (
        error instanceof AppError &&
        ['unauthorized', 'forbidden', 'rate_limited'].includes(error.code)
      )
        throw error;
    }
  }
  const output = (
    await ctx.provider.completeJSON({
      tier: 'fast',
      system:
        SAFETY +
        ' ' +
        language(ctx) +
        ' [TASK:repositoryPlan] Understand the project purpose, main workflows and module relationships from the supplied documentation, file inventory and symbol outlines. Select up to min(requestedFiles,30) REAL file paths, prioritizing the user goal and core behavior, followed by callers/dependencies/tests/docs useful for verification. Keep each reason under 120 characters and the summary under 1000 characters. Do not prioritize small files merely for their size. Give exact focusLines only when supported by outlines. Explain uncertainty when the manifest/outlines are partial. Return {"summary":"purpose and workflow","modules":[{"name":"module","purpose":"role and relationships","paths":["real/file"]}],"files":[{"path":"real/file","reason":"why inspect","role":"entry/core/dependency/test/docs","focusLines":[1]}]}. At most 8 modules, 5 paths per module, 200 characters per module purpose, and 8 focusLines per file. No invented paths.',
      user: untrusted({
        repo: parsed.repo,
        goal: parsed.goal,
        focus: parsed.focus,
        requestedFiles: parsed.maxFiles,
        documents: docs,
        inventory: manifest,
        inventoryTotal: inv.eligible.length,
        inventoryPartial: manifest.length < inv.eligible.length || inv.tree.truncated,
        outlines,
      }),
      schema: ModelPlan,
      signal: ctx.signal,
    })
  ).data;
  const real = new Set(inv.eligible.map((entry) => entry.path)),
    seen = new Set<string>();
  const files = output.files.filter(
    (file) => real.has(file.path) && !seen.has(file.path) && !!seen.add(file.path),
  );
  if (!files.length) throw new AppError('scan_plan_empty', 409);
  return RepositoryPlan.parse({
    repo: parsed.repo,
    repoId: inv.info.id,
    baseBranch: inv.info.default_branch,
    baseSha: inv.baseSha,
    goal: parsed.goal,
    summary: output.summary,
    modules: output.modules.map((module) => ({
      ...module,
      paths: module.paths.filter((path) => real.has(path)),
    })),
    files,
    documents: docs.map((doc) => doc.path),
    treeTruncated: inv.tree.truncated,
  });
}
export async function planRepository(ctx: RunContext, input: unknown): Promise<RepositoryPlan> {
  const parsed = RepositoryScanInput.parse(input),
    inv = await inventory(ctx, parsed.repo);
  return buildPlan(ctx, parsed, inv);
}
type Range = { start: number; end: number };
function selectRanges(body: string, focus: number[], goal: string, limit: number) {
  const lines = body.split('\n'),
    symbols = declarations(body);
  const starts = [...new Set([1, ...symbols.map((symbol) => symbol.line)])].sort((a, b) => a - b);
  const terms = goal
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((term) => term.length > 2);
  const units = starts.map((start, index) => ({
    start,
    end: (starts[index + 1] ?? lines.length + 1) - 1,
  }));
  units.sort((a, b) => {
    const rank = (r: Range) =>
      focus.some((line) => line >= r.start && line <= r.end)
        ? 0
        : terms.some((term) =>
              lines
                .slice(r.start - 1, Math.min(r.end, r.start + 4))
                .join(' ')
                .toLowerCase()
                .includes(term),
            )
          ? 1
          : r.start === 1
            ? 2
            : 3;
    return rank(a) - rank(b) || a.start - b.start;
  });
  const ranges: Range[] = [];
  let chars = 0;
  for (const unit of units) {
    const selected = { ...unit };
    let text = lines.slice(selected.start - 1, selected.end).join('\n');
    if (chars + text.length > limit) {
      if (ranges.length) continue;
      const anchor = focus.find((line) => line >= unit.start && line <= unit.end) ?? unit.start;
      selected.start = Math.max(unit.start, anchor - 40);
      selected.end = selected.start - 1;
      text = '';
      while (
        selected.end < unit.end &&
        text.length + (lines[selected.end]?.length ?? 0) + 1 <= limit
      ) {
        text += lines[selected.end] + '\n';
        selected.end++;
      }
    }
    if (selected.end >= selected.start && text.trim()) {
      ranges.push(selected);
      chars += text.length;
    }
    if (chars >= limit) break;
  }
  return {
    ranges: ranges.sort((a, b) => a.start - b.start),
    characters: chars,
    totalLines: lines.length,
    code: ranges
      .sort((a, b) => a.start - b.start)
      .map((range) =>
        lines
          .slice(range.start - 1, range.end)
          .map((line, i) => i + range.start + ': ' + line)
          .join('\n'),
      )
      .join('\n... omitted lines ...\n'),
  };
}
function relatedPaths(body: string, path: string, entries: Entry[]) {
  const names = [
    ...body.matchAll(
      /(?:from\s+['"]([^'"]+)['"]|(?:import|from)\s+([\w.]+)|require\(['"]([^'"]+)['"]\))/g,
    ),
  ]
    .map((match) => match[1] ?? match[2] ?? match[3]!)
    .slice(0, 40);
  const result: string[] = [];
  for (const name of names) {
    const stem = name.startsWith('.')
      ? posix.normalize(posix.join(posix.dirname(path), name))
      : name.replaceAll('.', '/');
    const found = entries.find(
      (entry) =>
        entry.path === stem ||
        entry.path.replace(/\.[^.]+$/, '') === stem ||
        entry.path.startsWith(stem + '/index.') ||
        entry.path === stem + '/__init__.py',
    );
    if (found && found.path !== path && !result.includes(found.path)) result.push(found.path);
  }
  return result;
}
export async function scanRepository(
  ctx: RunContext,
  input: unknown,
): Promise<RepositoryScanResult> {
  const parsed = RepositoryScanInput.parse(input),
    inv = await inventory(ctx, parsed.repo);
  const saved = RepositoryPlan.safeParse(ctx.checkpoint?.plan);
  let plan: RepositoryPlan;
  if (saved.success) {
    plan = saved.data;
    if (
      plan.repo !== parsed.repo ||
      plan.repoId !== inv.info.id ||
      plan.baseSha !== inv.baseSha ||
      plan.baseBranch !== inv.info.default_branch ||
      plan.goal !== parsed.goal
    )
      throw new AppError('stale_repository', 409);
  } else plan = await buildPlan(ctx, parsed, inv);
  const allowed = new Map(inv.eligible.map((entry) => [entry.path, entry]));
  const selected = [
    ...new Set(
      parsed.selectedPaths ?? plan.files.slice(0, parsed.maxFiles).map((file) => file.path),
    ),
  ];
  if (
    !selected.length ||
    selected.length > parsed.maxFiles ||
    selected.some((path) => !allowed.has(path))
  )
    throw new AppError('validation', 400);
  const docs = await documents(ctx, inv);
  const discussions: { number: number; title: string; url: string; body: string }[] = [];
  try {
    for (const issue of (await inv.github.listIssues(inv.owner, inv.repo)).items.slice(0, 20)) {
      const body = (issue.body ?? '').slice(0, 2000);
      discussions.push({
        number: issue.number,
        title: issue.title,
        url: issue.html_url,
        body: sourceSkipReason({ path: 'issue.md' }, body) ? '' : body,
      });
    }
  } catch (error) {
    if (
      error instanceof AppError &&
      ['unauthorized', 'forbidden', 'rate_limited'].includes(error.code)
    )
      throw error;
  }
  const skipped: { path: string; reason: string }[] = inv.tree.entries
    .filter((entry) => sourceSkipReason(entry))
    .map((entry) => ({ path: entry.path, reason: sourceSkipReason(entry)! }));
  const sources: {
    entry: Entry;
    body: string;
    code: string;
    ranges: Range[];
    characters: number;
    totalLines: number;
    partial: boolean;
    related: string[];
  }[] = [];
  const used = new Set<string>();
  let characters = 0;
  // Selected modules come first; direct imports fill the remaining file budget.
  const pending = [...selected];
  for (let index = 0; index < pending.length; index++) {
    cancelled(ctx);
    const path = pending[index]!;
    if (used.has(path)) continue;
    used.add(path);
    const entry = allowed.get(path);
    if (!entry) continue;
    if (sources.length >= parsed.maxFiles || characters >= 160000) {
      skipped.push({ path, reason: 'scan_budget' });
      continue;
    }
    await ctx.onProgress?.({
      progress: {
        stage: 'reading',
        completed: sources.length,
        total: Math.min(pending.length, parsed.maxFiles),
        current: path,
      },
      checkpoint: { plan },
    });
    try {
      const body = (await readSource(inv.github, inv.owner, inv.repo, entry)).replaceAll(
        '\r\n',
        '\n',
      );
      const excerpt = selectRanges(
        body,
        plan.files.find((file) => file.path === path)?.focusLines ?? [],
        parsed.goal,
        Math.min(16000, 160000 - characters),
      );
      if (!excerpt.code) {
        skipped.push({ path, reason: 'empty' });
        continue;
      }
      const related = relatedPaths(body, path, inv.eligible);
      sources.push({
        entry,
        body,
        ...excerpt,
        partial: excerpt.ranges.reduce((n, r) => n + r.end - r.start + 1, 0) < excerpt.totalLines,
        related,
      });
      characters += excerpt.characters;
      for (const dependency of related) if (!pending.includes(dependency)) pending.push(dependency);
    } catch (error) {
      if (
        error instanceof AppError &&
        ['unauthorized', 'forbidden', 'rate_limited', 'job_cancelled'].includes(error.code)
      )
        throw error;
      skipped.push({ path, reason: error instanceof AppError ? error.code : 'read_failed' });
    }
  }
  for (const entry of inv.eligible)
    if (!used.has(entry.path))
      skipped.push({
        path: entry.path,
        reason: docs.some((doc) => doc.path === entry.path) ? 'context_only' : 'outside_plan',
      });
  const batches: Array<typeof sources> = [];
  for (let i = 0; i < sources.length; i += 2) batches.push(sources.slice(i, i + 2));
  const batchKeys = batches.map((batch) =>
    digest({
      version: 3,
      repoId: inv.info.id,
      sha: inv.baseSha,
      goal: parsed.goal,
      mode: parsed.mode,
      focus: parsed.focus,
      lang: ctx.lang,
      models: [ctx.env.LLM_MODEL_FAST, ctx.env.LLM_MODEL_DEEP, ctx.env.LLM_DEEP_THINKING],
      docs,
      discussions,
      files: batch.map((file) => ({
        path: file.entry.path,
        sha: file.entry.sha,
        code: file.code,
      })),
    }),
  );
  const available = (ctx.checkpoint?.batches ?? {}) as Record<string, unknown>;
  const cache: Record<string, unknown> = Object.fromEntries(
    batchKeys.filter((key) => Object.hasOwn(available, key)).map((key) => [key, available[key]]),
  );
  const completed = new Map<number, { data: z.infer<typeof ScanBatch>; cached: boolean }>(),
    failed = new Set<number>();
  let invalidFindings = 0;
  function report() {
    const analyzed = [...completed.keys()]
      .sort((a, b) => a - b)
      .flatMap((index) => batches[index]!);
    const findings: RepositoryScanResult['findings'] = [];
    const seen = new Set<string>();
    invalidFindings = 0;
    for (const index of [...completed.keys()].sort((a, b) => a - b))
      for (const finding of completed.get(index)!.data.findings) {
        const doc = docs.find((item) => item.path === finding.path);
        const source =
          batches[index]!.find((file) => file.entry.path === finding.path) ??
          (doc
            ? { body: doc.body, ranges: [{ start: 1, end: doc.body.split('\n').length }] }
            : undefined);
        if (
          !source ||
          finding.confidence < 0.65 ||
          !source.ranges.some(
            (range) => finding.line >= range.start && finding.line <= range.end,
          ) ||
          !matchesEvidence(source.body, finding.line, finding.evidence)
        ) {
          invalidFindings++;
          continue;
        }
        if (
          (parsed.focus === 'bugs' && finding.kind !== 'bug') ||
          (parsed.focus === 'opportunities' && finding.kind === 'bug')
        )
          continue;
        const key = finding.path + ':' + finding.line + ':' + finding.title;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({
          ...finding,
          id: randomUUID(),
          discussionOnly: finding.kind !== 'bug',
          relatedIssues: finding.relatedIssues.filter((number) =>
            discussions.some((issue) => issue.number === number),
          ),
          sourceUrl: sourceUrl(parsed.repo, inv.baseSha, finding.path, finding.line),
        });
      }
    const failures = [...failed].flatMap((index) =>
      batches[index]!.map((file) => ({ path: file.entry.path, reason: 'analysis_failed' })),
    );
    return RepositoryScanResult.parse({
      repo: parsed.repo,
      repoId: inv.info.id,
      baseBranch: inv.info.default_branch,
      baseSha: inv.baseSha,
      goal: parsed.goal,
      treeTruncated: inv.tree.truncated,
      eligibleFiles: inv.eligible.length,
      examinedFiles: analyzed.length,
      examinedCharacters: analyzed.reduce((sum, file) => sum + file.characters, 0),
      analysisFailedFiles: failures.length,
      scanned: analyzed.map((file) => ({
        path: file.entry.path,
        lines: file.ranges.reduce((n, r) => n + r.end - r.start + 1, 0),
        totalLines: file.totalLines,
        partial: file.partial,
      })),
      ranges: analyzed.flatMap((file) =>
        file.ranges.map((range) => ({ path: file.entry.path, ...range })),
      ),
      skipped: [...failures, ...skipped].slice(0, 300),
      skippedCount: failures.length + skipped.length,
      findings: findings.slice(0, 100),
      invalidFindings,
      relatedIssues: discussions.map(({ body: _, ...issue }) => issue),
      mode: parsed.mode,
      focus: parsed.focus,
      reusedBatches: [...completed.values()].filter((batch) => batch.cached).length,
      plan,
    });
  }
  let write = Promise.resolve();
  function save(current?: string) {
    const data = JSON.parse(
      JSON.stringify({
        ...report(),
        progress: {
          stage: 'analyzing',
          completed: completed.size + failed.size,
          total: batches.length,
          current,
          cached: [...completed.values()].filter((batch) => batch.cached).length,
        },
        checkpoint: { plan, batches: cache },
      }),
    );
    write = write.then(() => ctx.onProgress?.(data));
    return write;
  }
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      cancelled(ctx);
      const index = cursor++;
      if (index >= batches.length) return;
      const batch = batches[index]!;
      const key = batchKeys[index]!;
      const existing = ScanBatch.safeParse(cache[key]);
      if (existing.success) {
        completed.set(index, { data: existing.data, cached: true });
        await save();
        continue;
      }
      const analyze = (tier: 'fast' | 'deep') =>
        ctx.provider.completeJSON({
          tier,
          signal: ctx.signal,
          system:
            SAFETY +
            ' ' +
            language(ctx) +
            ' [TASK:repositoryScan] Inspect the supplied actual source and project documentation. Return at most four grounded findings. Focus is ' +
            parsed.focus +
            '. For bugs give exact evidence and verification steps without claiming tests ran. For improvements consider additions, simplifications, removals, usability, docs and tests aligned with the project purpose. A proposal must include audience/scenario, benefit and tradeoffs, and discussionOnly=true. Never claim a feature is absent just because it is outside supplied context; inspect the supplied inventory and related discussions and frame uncertain ideas as questions. Each finding must anchor to an actual supplied source or documentation line with an exact quote, omitting any line-number prefix. Related issues must be from the supplied list. No findings is valid. Fields: {"findings":[{"path":"real/path","line":1,"kind":"bug|improvement|tests|docs","title":"up to 200 chars","explanation":"up to 1000 chars","evidence":"5–1000 exact chars","suggestion":"up to 1000 chars","verification":["up to five suggested checks, not executed"],"confidence":0.9,"relatedIssues":[],"audience":"scenario","benefit":"expected value","tradeoffs":"cost/uncertainty","discussionOnly":false}]}. Each list item under 1000 chars. Output valid JSON.',
          user: untrusted({
            repo: parsed.repo,
            goal: parsed.goal,
            project: plan.summary,
            modules: plan.modules,
            documents: docs.map((doc) => ({
              path: doc.path,
              body: doc.body
                .split('\n')
                .map((line, index) => index + 1 + ': ' + line)
                .join('\n'),
            })),
            discussions,
            inventory: plan.files.map((file) => file.path),
            files: batch.map((file) => ({
              path: file.entry.path,
              partial: file.partial,
              related: file.related,
              code: file.code,
            })),
          }),
          schema: ScanBatch,
        });
      try {
        let result;
        try {
          result = await analyze(parsed.mode);
        } catch (error) {
          if (
            parsed.mode !== 'deep' ||
            !(
              error instanceof AppError &&
              ['llm_output_invalid', 'llm_unavailable'].includes(error.code)
            )
          )
            throw error;
          result = await analyze('fast');
        }
        cancelled(ctx);
        cache[key] = result.data;
        completed.set(index, { data: result.data, cached: false });
      } catch (error) {
        if (!(
          error instanceof AppError &&
          ['llm_output_invalid', 'llm_unavailable'].includes(error.code)
        ))
          throw error;
        failed.add(index);
      }
      await save(batch.map((file) => file.entry.path).join(', '));
    }
  };
  await save();
  const outcomes = await Promise.allSettled(
    Array.from({ length: Math.min(2, batches.length) }, worker),
  );
  await write;
  const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
  if (rejected?.status === 'rejected') throw rejected.reason;
  cancelled(ctx);
  return Object.assign(report(), {
    checkpoint: { plan, batches: cache },
    progress: { stage: 'done', completed: batches.length, total: batches.length },
  });
}
