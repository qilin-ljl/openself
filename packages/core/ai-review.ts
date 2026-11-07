import { eq, and, schema } from '@openself/db';
import {
  RiskMap,
  FindingList,
  RuleCard,
  RewriteList,
  StyleProfile,
  DEFAULT_STYLE_PROFILE,
  type Finding,
} from '@openself/shared/ai';
import * as prompts from '@openself/llm/prompts';
import { PLAYBOOKS } from '@openself/llm/playbooks';
import { AppError } from '@openself/shared/errors';
import type { RunContext } from './ai-context';
import { skipReason, chunks, cleanFindings } from './review-analysis';
export async function buildRulecard(
  ctx: RunContext,
  repoFullName: string,
  signal = AbortSignal.timeout(60000),
) {
  const [owner, repo] = repoFullName.split('/') as [string, string],
    gh = await ctx.workspace.githubFor(ctx.user.id),
    info = await ctx.workspace.assertRepo(ctx.user, owner, repo);
  if (info.private && !ctx.user.privateAiConsentAt)
    throw new AppError('private_ai_consent_required', 403);
  const sha = await gh.getBranchSha(owner, repo, info.default_branch);
  const [cached] = await ctx.db
    .select()
    .from(schema.repoRulecards)
    .where(eq(schema.repoRulecards.repoFullName, repoFullName));
  if (cached && cached.sourceSha === sha && cached.expiresAt > new Date())
    return RuleCard.parse(cached.rulecardJson);
  const guide = await gh.getContributing(owner, repo);
  let comments: string[] = [];
  try {
    comments = await gh.getRecentMaintainerComments(owner, repo, signal);
  } catch {
    /* Evidence can consist of the guide alone. */
  }
  const configs: Record<string, string> = {};
  for (const path of [
    'eslint.config.js',
    'eslint.config.mjs',
    '.eslintrc.json',
    'pyproject.toml',
  ]) {
    try {
      const content = await gh.getFileContent(owner, repo, path, sha);
      if (content) configs[path] = content.slice(0, 6000);
    } catch {
      /* Optional config. */
    }
  }
  const result = await ctx.provider.completeJSON({
    tier: 'deep',
    system: prompts.rulecard(ctx.lang),
    user: prompts.untrusted({ contributing: guide.body.slice(0, 16000), configs, comments }),
    schema: RuleCard,
    signal,
  });
  await ctx.db
    .insert(schema.repoRulecards)
    .values({
      repoFullName,
      rulecardJson: result.data,
      sourceSha: sha,
      expiresAt: new Date(Date.now() + 7 * 86400000),
    })
    .onConflictDoUpdate({
      target: schema.repoRulecards.repoFullName,
      set: {
        rulecardJson: result.data,
        sourceSha: sha,
        expiresAt: new Date(Date.now() + 7 * 86400000),
      },
    });
  return result.data;
}
export async function runReview(ctx: RunContext, sessionId: string) {
  const [session] = await ctx.db
    .select()
    .from(schema.reviewSessions)
    .where(
      and(eq(schema.reviewSessions.id, sessionId), eq(schema.reviewSessions.userId, ctx.user.id)),
    );
  if (!session) throw new AppError('not_found', 404);
  if (session.status === 'done') return { reviewSessionId: sessionId };
  const [owner, repo] = session.repoFullName.split('/') as [string, string],
    gh = await ctx.workspace.githubFor(ctx.user.id),
    repository = await ctx.workspace.assertRepo(ctx.user, owner, repo);
  if (repository.private && !ctx.user.privateAiConsentAt)
    throw new AppError('private_ai_consent_required', 403);
  const pull = await gh.getPull(owner, repo, session.prNumber, true);
  if (pull.head.sha !== session.headSha) throw new AppError('stale_head', 409);
  await ctx.db
    .update(schema.reviewSessions)
    .set({ status: 'scoring', error: null, progress: 0 })
    .where(eq(schema.reviewSessions.id, sessionId));
  const { files, truncated } = await gh.listPullFiles(owner, repo, session.prNumber, true),
    skipped: { path: string; reason: string }[] = [];
  const candidates = files.filter((f) => {
    const reason = skipReason(f) || (f.patch!.length > 1000000 ? 'too_large' : null);
    if (reason) skipped.push({ path: f.filename, reason });
    return !reason;
  });
  let rulecard: RuleCard | null = null;
  const controller = new AbortController();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    rulecard = await Promise.race([
      buildRulecard(ctx, session.repoFullName, controller.signal),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => {
          controller.abort();
          reject(new AppError('rulecard_timeout', 504));
        }, 60000);
      }),
    ]);
  } catch {
    /* The report exposes missing rule-card coverage. */
  } finally {
    if (deadline) clearTimeout(deadline);
  }
  const risk: RiskMap['files'] = [];
  for (let offset = 0; offset < candidates.length; offset += 40) {
    const batch = candidates.slice(offset, offset + 40);
    const response = await ctx.provider.completeJSON({
      tier: 'fast',
      system: prompts.riskScore(ctx.lang),
      user: prompts.untrusted(
        batch.map((f) => ({
          path: f.filename,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch?.split('\n').slice(0, 80).join('\n'),
        })),
      ),
      schema: RiskMap,
    });
    for (const f of batch)
      risk.push(
        response.data.files.find((r) => r.path === f.filename) ?? {
          path: f.filename,
          score: 3,
          reasons: [],
        },
      );
  }
  const risky = candidates.filter(
      (f) => (risk.find((r) => r.path === f.filename)?.score ?? 3) >= 3,
    ),
    selected = risky.slice(0, ctx.env.REVIEW_MAX_FILES);
  for (const f of candidates.filter((f) => !selected.includes(f)))
    skipped.push({ path: f.filename, reason: risky.includes(f) ? 'review_budget' : 'low_risk' });
  if (truncated) skipped.push({ path: '*', reason: 'github_file_limit' });
  const coverage = { files: risk, skipped, reviewedFiles: 0, rulecardAvailable: !!rulecard };
  await ctx.db
    .update(schema.reviewSessions)
    .set({ status: 'reviewing', riskMapJson: coverage })
    .where(eq(schema.reviewSessions.id, sessionId));
  const [profile] = await ctx.db
    .select()
    .from(schema.styleProfiles)
    .where(eq(schema.styleProfiles.userId, ctx.user.id));
  const style = profile ? StyleProfile.parse(profile.profileJson) : DEFAULT_STYLE_PROFILE;
  const findings: Finding[] = [];
  let next = 0,
    completed = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, selected.length) }, async () => {
      while (next < selected.length) {
        const file = selected[next++]!;
        for (const chunk of chunks(file.patch!)) {
          const result = await ctx.provider.completeJSON({
            tier: 'deep',
            system: prompts.review(ctx.lang),
            user: prompts.untrusted({
              rulecard,
              playbooks: session.playbooks.map((id) => PLAYBOOKS[id as keyof typeof PLAYBOOKS]),
              style,
              path: file.filename,
              patch: chunk,
            }),
            schema: FindingList,
          });
          findings.push(...result.data.findings.filter((f) => f.path === file.filename));
        }
        completed++;
        await ctx.db
          .update(schema.reviewSessions)
          .set({ progress: Math.floor((completed / selected.length) * 95) })
          .where(eq(schema.reviewSessions.id, sessionId));
      }
    }),
  );
  const clean = cleanFindings(findings, files, ctx.user.maxFindings);
  if (profile && clean.length) {
    const rewritten = await ctx.provider.completeJSON({
      tier: 'fast',
      system: prompts.rewrite(ctx.lang),
      user: prompts.untrusted({
        style,
        notes: profile.profileMd,
        items: clean.map((f, i) => ({ id: String(i), title: f.title, body: f.body })),
      }),
      schema: RewriteList,
    });
    for (const [i, f] of clean.entries()) {
      const item = rewritten.data.items.find((item) => item.id === String(i));
      if (item) f.body = item.body;
    }
  }
  if ((await gh.getPull(owner, repo, session.prNumber, true)).head.sha !== session.headSha)
    throw new AppError('stale_head', 409);
  await ctx.db.transaction(async (tx) => {
    await tx.delete(schema.reviewFindings).where(eq(schema.reviewFindings.sessionId, sessionId));
    if (clean.length)
      await tx.insert(schema.reviewFindings).values(
        clean.map((f) => ({
          ...f,
          startLine: f.startLine ?? null,
          suggestion: f.suggestion ?? null,
          sessionId,
        })),
      );
    await tx
      .update(schema.reviewSessions)
      .set({
        status: 'done',
        progress: 100,
        error: null,
        riskMapJson: { ...coverage, reviewedFiles: completed },
      })
      .where(eq(schema.reviewSessions.id, sessionId));
  });
  return { reviewSessionId: sessionId };
}
