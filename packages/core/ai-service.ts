import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { eq, and, or, lt, desc, schema, sql } from '@openself/db';
import {
  StartReview,
  IssueAIInput,
  StyleProfile,
  DEFAULT_STYLE_PROFILE,
  type ReviewDTO,
  type JobDTO,
  type JobListItem,
  type JobProgress,
} from '@openself/shared/ai';
import { z } from '@openself/shared/api';
import { AppError } from '@openself/shared/errors';
import type { User } from './drafts';
import type { AIContext, RunContext } from './ai-context';
import { reserveAI, resolveProvider, type Billing } from './ai-billing';
import { runReview, buildRulecard } from './ai-review';
import { runAssistantTask } from './ai-assistant';
import { encrypt } from './crypto';
import { recordEdit } from './style-feedback';
import { repositoryLanguage } from './review-analysis';
import { redisConnection } from './queue';
import {
  IdeaInput,
  RepositoryScanInput,
  RepositoryScanResult,
  RepositoryPlan,
  PrepareChangeInput,
} from '@openself/shared/contributions';
import {
  discoverProjects,
  planRepository,
  scanRepository,
  prepareCodeChange,
} from './contributions';
export type AIKind =
  | 'review.run'
  | 'rulecard.build'
  | 'style.build'
  | 'issue.check'
  | 'issue.draft'
  | 'issue.quality'
  | 'translate'
  | 'discovery.find'
  | 'repository.plan'
  | 'repository.scan'
  | 'change.prepare';
type Payload = { input: unknown; billing: Billing; reviewSessionId?: string; lang: 'zh' | 'en' };
export function createAIService(ctx: AIContext) {
  const { db, env, workspace } = ctx;
  const queues = new Map<string, Queue>();
  async function enqueue(id: string, kind: string) {
    if (ctx.enqueue) return ctx.enqueue(id, kind);
    const name = kind.split('.')[0] === 'translate' ? 'issue' : kind.split('.')[0]!;
    let queue = queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        connection: {
          ...redisConnection(env.REDIS_URL),
          maxRetriesPerRequest: 1,
          connectTimeout: 2000,
          retryStrategy: () => null,
        },
      });
      queue.on('error', () => {});
      queues.set(name, queue);
    }
    await queue.add(
      kind,
      { jobId: id },
      {
        jobId: id,
        attempts: 2,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }
  async function dispatch(id: string, kind: string) {
    try {
      await enqueue(id, kind);
    } catch {
      /* Queued rows are durable and reconciled by the worker. */
    }
  }
  async function privacy(user: User, repoFullName: string) {
    const [owner, repo] = repoFullName.toLowerCase().split('/') as [string, string];
    const info = await workspace.assertRepo(user, owner, repo);
    if (info.private && !user.privateAiConsentAt)
      throw new AppError('private_ai_consent_required', 403);
    return info;
  }
  async function submit(user: User, kind: AIKind, input: unknown, quota: Billing['kind'] = 'aux') {
    const job = await db.transaction(async (tx) => {
      await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.id, user.id))
        .for('update');
      const [existing] = await tx
        .select()
        .from(schema.aiJobs)
        .where(
          and(
            eq(schema.aiJobs.userId, user.id),
            eq(schema.aiJobs.kind, kind),
            or(eq(schema.aiJobs.status, 'queued'), eq(schema.aiJobs.status, 'running')),
            sql`${schema.aiJobs.payloadJson}->'input' = ${JSON.stringify(input)}::jsonb`,
            sql`${schema.aiJobs.payloadJson}->>'lang' = ${user.locale}`,
          ),
        )
        .limit(1);
      if (existing) return existing;
      const billing = await reserveAI(tx, user.id, quota);
      const [job] = await tx
        .insert(schema.aiJobs)
        .values({
          userId: user.id,
          kind,
          payloadJson: { input, billing, lang: user.locale } satisfies Payload,
        })
        .returning();
      return job!;
    });
    await dispatch(job.id, kind);
    return { jobId: job.id };
  }
  async function getJob(userId: string, id: string): Promise<JobDTO> {
    const [job] = await db
      .select()
      .from(schema.aiJobs)
      .where(and(eq(schema.aiJobs.id, id), eq(schema.aiJobs.userId, userId)));
    if (!job) throw new AppError('not_found', 404);
    const safeResult =
      job.resultJson && typeof job.resultJson === 'object'
        ? Object.fromEntries(
            Object.entries(job.resultJson).filter(
              ([key]) => !['checkpoint', '_runId'].includes(key),
            ),
          )
        : job.resultJson;
    return {
      id: job.id,
      kind: job.kind,
      status: job.status,
      resultJson: safeResult,
      error: job.error,
      input: (job.payloadJson as Payload).input,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      attempts: job.attempts,
    };
  }
  async function getReview(userId: string, id: string): Promise<ReviewDTO> {
    const [session] = await db
      .select()
      .from(schema.reviewSessions)
      .where(and(eq(schema.reviewSessions.id, id), eq(schema.reviewSessions.userId, userId)));
    if (!session) throw new AppError('not_found', 404);
    const findings = await db
      .select()
      .from(schema.reviewFindings)
      .where(eq(schema.reviewFindings.sessionId, id));
    return {
      id,
      status: session.status,
      headSha: session.headSha,
      progress: session.progress,
      error: session.error,
      riskMapJson: session.riskMapJson as ReviewDTO['riskMapJson'],
      findings: findings.map((f) => ({
        ...f,
        startLine: f.startLine ?? undefined,
        suggestion: f.suggestion ?? undefined,
        category: f.category as ReviewDTO['findings'][number]['category'],
      })),
    };
  }
  async function getScan(userId: string, jobId: string) {
    const job = await getJob(userId, jobId);
    if (job.kind !== 'repository.scan' || job.status !== 'done')
      throw new AppError('scan_not_ready', 409);
    return RepositoryScanResult.parse(job.resultJson);
  }
  return {
    getJob,
    getReview,
    enqueue,
    async listJobs(userId: string, page = 1): Promise<{ items: JobListItem[]; more: boolean }> {
      const rows = await db
        .select()
        .from(schema.aiJobs)
        .where(eq(schema.aiJobs.userId, userId))
        .orderBy(desc(schema.aiJobs.createdAt))
        .limit(21)
        .offset((page - 1) * 20);
      return {
        more: rows.length > 20,
        items: rows.slice(0, 20).map((job) => {
          const payload = job.payloadJson as Payload,
            input = payload.input as Record<string, unknown> | null;
          const result = (job.resultJson ?? {}) as Record<string, unknown>;
          return {
            id: job.id,
            kind: job.kind,
            status: job.status,
            error: job.error,
            repo: typeof input?.repo === 'string' ? input.repo : null,
            href: '/tasks/' + job.id,
            createdAt: job.createdAt.toISOString(),
            updatedAt: job.updatedAt.toISOString(),
            attempts: job.attempts,
            progress: result.progress as JobProgress | undefined,
            durationMs: typeof result.durationMs === 'number' ? result.durationMs : undefined,
            incomplete: Number(result.analysisFailedFiles ?? 0) > 0,
          };
        }),
      };
    },
    async cancelJob(userId: string, id: string) {
      await getJob(userId, id);
      const [current] = await db
        .select()
        .from(schema.aiJobs)
        .where(and(eq(schema.aiJobs.id, id), eq(schema.aiJobs.userId, userId)));
      const changed = await db
        .update(schema.aiJobs)
        .set({
          status: 'cancelled',
          error: 'job_cancelled',
          resultJson: sql`coalesce(${schema.aiJobs.resultJson}, '{}'::jsonb) || '{"usageComplete":false}'::jsonb`,
        })
        .where(
          and(
            eq(schema.aiJobs.id, id),
            eq(schema.aiJobs.userId, userId),
            or(eq(schema.aiJobs.status, 'queued'), eq(schema.aiJobs.status, 'running')),
          ),
        )
        .returning({ id: schema.aiJobs.id });
      const payload = current?.payloadJson as Payload | undefined;
      if (
        changed.length &&
        payload?.reviewSessionId &&
        current &&
        ['queued', 'running'].includes(current.status)
      )
        await db
          .update(schema.reviewSessions)
          .set({ status: 'failed', error: 'job_cancelled' })
          .where(
            and(
              eq(schema.reviewSessions.id, payload.reviewSessionId),
              eq(schema.reviewSessions.userId, userId),
            ),
          );
      return getJob(userId, id);
    },
    async retryJob(user: User, id: string) {
      const job = await getJob(user.id, id);
      if (['queued', 'running'].includes(job.status)) return { jobId: id };
      const incomplete =
        job.kind === 'repository.scan' &&
        Number((job.resultJson as Record<string, unknown> | null)?.analysisFailedFiles ?? 0) > 0;
      if (job.status === 'done' && !incomplete) throw new AppError('job_already_done', 409);
      const input = job.input as Record<string, unknown> | null;
      if (typeof input?.repo === 'string') await privacy(user, input.repo);
      const changed = await db.transaction(async (tx) => {
        await tx
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.id, user.id))
          .for('update');
        const [current] = await tx
          .select()
          .from(schema.aiJobs)
          .where(and(eq(schema.aiJobs.id, id), eq(schema.aiJobs.userId, user.id)))
          .for('update');
        if (!current || ['queued', 'running'].includes(current.status)) return false;
        const payload = current.payloadJson as Payload;
        const billing = await reserveAI(tx, user.id, payload.billing.kind);
        await tx
          .update(schema.aiJobs)
          .set({ status: 'queued', error: null, attempts: 0, payloadJson: { ...payload, billing } })
          .where(eq(schema.aiJobs.id, id));
        return true;
      });
      if (changed) await dispatch(id, job.kind);
      return { jobId: id };
    },
    async plan(user: User, input: unknown) {
      const parsed = RepositoryScanInput.parse(input);
      const [owner, name] = parsed.repo.split('/') as [string, string];
      const info = await workspace.assertRepo(user, owner, name);
      if (info.private) throw new AppError('scan_public_only', 403);
      return submit(user, 'repository.plan', parsed);
    },
    discover: (user: User, input: unknown) =>
      submit(user, 'discovery.find', IdeaInput.parse(input)),
    async scan(user: User, input: unknown) {
      const parsed = RepositoryScanInput.parse(input);
      const [owner, name] = parsed.repo.split('/') as [string, string];
      const repository = await workspace.assertRepo(user, owner, name);
      if (repository.private) throw new AppError('scan_public_only', 403);
      if (parsed.planJobId) {
        const job = await getJob(user.id, parsed.planJobId);
        if (job.kind !== 'repository.plan' || job.status !== 'done')
          throw new AppError('scan_not_ready', 409);
        const plan = RepositoryPlan.parse(job.resultJson);
        if (plan.repo !== parsed.repo || plan.goal !== parsed.goal)
          throw new AppError('validation', 400);
      }
      return submit(user, 'repository.scan', parsed);
    },
    async prepareChange(user: User, input: unknown) {
      const parsed = PrepareChangeInput.parse(input);
      const scan = await getScan(user.id, parsed.scanJobId);
      if (!scan.findings.some((finding) => finding.id === parsed.findingId))
        throw new AppError('not_found', 404);
      return submit(user, 'change.prepare', parsed);
    },
    async findingContext(user: User, scanJobId: string, findingId: string) {
      const scan = await getScan(user.id, scanJobId);
      const finding = scan.findings.find((item) => item.id === findingId);
      if (!finding) throw new AppError('not_found', 404);
      const note =
        user.locale === 'zh'
          ? '这是静态源码分析得到的候选问题，尚未执行复现或测试。请基于证据起草 Issue，不要声称已复现。'
          : 'This is a static-analysis candidate. Reproduction and tests have not been executed. Draft an issue grounded in this evidence without claiming reproduction.';
      return {
        repo: scan.repo,
        title: finding.title,
        description: [
          note,
          finding.title,
          finding.explanation,
          finding.sourceUrl,
          finding.evidence,
          finding.suggestion,
          finding.discussionOnly
            ? user.locale === 'zh'
              ? '这是待讨论的改进提案，不是已证实的缺陷；不要声称项目确定缺少某功能。'
              : 'This is a discussion proposal, not a confirmed defect. Do not claim a feature is certainly absent.'
            : '',
          finding.audience
            ? (user.locale === 'zh' ? '适用场景：' : 'Audience: ') + finding.audience
            : '',
          finding.benefit
            ? (user.locale === 'zh' ? '预期收益：' : 'Benefit: ') + finding.benefit
            : '',
          finding.tradeoffs
            ? (user.locale === 'zh' ? '代价与不确定性：' : 'Tradeoffs: ') + finding.tradeoffs
            : '',
          ...finding.verification,
        ]
          .filter(Boolean)
          .join('\n\n'),
      };
    },
    async startReview(user: User, input: unknown) {
      const parsed = StartReview.parse(input),
        repo = parsed.repo.toLowerCase();
      await privacy(user, repo);
      const [owner, name] = repo.split('/') as [string, string],
        gh = await workspace.githubFor(user.id),
        pull = await gh.getPull(owner, name, parsed.prNumber, true);
      const outputLanguage =
        parsed.lang ?? repositoryLanguage((await gh.getReadme(owner, name)).body);
      const result = await db.transaction(async (tx) => {
        await tx
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.id, user.id))
          .for('update');
        const [old] = await tx
          .select()
          .from(schema.reviewSessions)
          .where(
            and(
              eq(schema.reviewSessions.userId, user.id),
              eq(schema.reviewSessions.repoFullName, repo),
              eq(schema.reviewSessions.prNumber, parsed.prNumber),
              eq(schema.reviewSessions.headSha, pull.head.sha),
            ),
          );
        if (old && old.status !== 'failed') return { reviewSessionId: old.id, jobId: null };
        const billing = await reserveAI(tx, user.id, 'review');
        const [session] = old
          ? await tx
              .update(schema.reviewSessions)
              .set({ status: 'queued', error: null, progress: 0, playbooks: parsed.playbooks })
              .where(eq(schema.reviewSessions.id, old.id))
              .returning()
          : await tx
              .insert(schema.reviewSessions)
              .values({
                userId: user.id,
                repoFullName: repo,
                prNumber: parsed.prNumber,
                headSha: pull.head.sha,
                playbooks: parsed.playbooks,
              })
              .returning();
        const [job] = await tx
          .insert(schema.aiJobs)
          .values({
            userId: user.id,
            kind: 'review.run',
            payloadJson: {
              input: parsed,
              billing,
              reviewSessionId: session!.id,
              lang: outputLanguage,
            } satisfies Payload,
          })
          .returning();
        return { reviewSessionId: session!.id, jobId: job!.id };
      });
      if (result.jobId) await dispatch(result.jobId, 'review.run');
      return result;
    },
    async issue(user: User, kind: 'issue.check' | 'issue.draft' | 'issue.quality', input: unknown) {
      const parsed =
        kind === 'issue.quality'
          ? z
              .object({
                repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
                title: z.string().max(200),
                body: z.string().max(60000),
                templateId: z.string().optional(),
              })
              .parse(input)
          : IssueAIInput.parse(input);
      await privacy(user, parsed.repo);
      return submit(user, kind, parsed, kind === 'issue.draft' ? 'issue' : 'aux');
    },
    async translate(user: User, input: unknown) {
      const parsed = z
        .object({
          repo: z
            .string()
            .regex(/^[\w.-]+\/[\w.-]+$/)
            .optional(),
          text: z.string().min(1).max(60000),
          to: z.enum(['zh', 'en']),
        })
        .parse(input);
      if (parsed.repo) await privacy(user, parsed.repo);
      return submit(user, 'translate', parsed);
    },
    rebuildStyle: (user: User) => submit(user, 'style.build', {}),
    async rulecard(user: User, repo: string) {
      await privacy(user, repo);
      return submit(user, 'rulecard.build', { repo });
    },
    async editFinding(user: User, sessionId: string, id: string, input: unknown) {
      await getReview(user.id, sessionId);
      const parsed = z
        .object({
          status: z.enum(['accepted', 'edited', 'rejected']),
          body: z.string().min(1).max(2000).optional(),
        })
        .parse(input);
      const [old] = await db
        .select()
        .from(schema.reviewFindings)
        .where(
          and(eq(schema.reviewFindings.id, id), eq(schema.reviewFindings.sessionId, sessionId)),
        );
      if (!old) throw new AppError('not_found', 404);
      const [saved] = await db
        .update(schema.reviewFindings)
        .set({
          status: parsed.body && parsed.body !== old.body ? 'edited' : parsed.status,
          ...(parsed.body ? { body: parsed.body } : {}),
        })
        .where(eq(schema.reviewFindings.id, id))
        .returning();
      if (parsed.body) await recordEdit(db, user.id, 'finding', old.body, parsed.body);
      return saved;
    },
    async settings(userId: string) {
      const [key] = await db
        .select({ last4: schema.userApiKeys.last4 })
        .from(schema.userApiKeys)
        .where(eq(schema.userApiKeys.userId, userId));
      const [style] = await db
        .select()
        .from(schema.styleProfiles)
        .where(eq(schema.styleProfiles.userId, userId));
      const usage = await db
        .select()
        .from(schema.usageCounters)
        .where(eq(schema.usageCounters.userId, userId))
        .orderBy(desc(schema.usageCounters.date))
        .limit(100);
      const published = await db
        .select({
          date: sql<string>`(${schema.auditLog.createdAt} at time zone 'Asia/Shanghai')::date::text`,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.auditLog)
        .where(eq(schema.auditLog.userId, userId))
        .groupBy(sql`1`)
        .orderBy(sql`1 desc`)
        .limit(14);
      const statistics = new Map<
        string,
        {
          date: string;
          reviews: number;
          issues: number;
          published: number;
          tokensIn: number;
          tokensOut: number;
        }
      >();
      for (const row of usage) {
        const item = statistics.get(row.date) ?? {
          date: row.date,
          reviews: 0,
          issues: 0,
          published: 0,
          tokensIn: 0,
          tokensOut: 0,
        };
        if (row.kind.endsWith('.review')) item.reviews += row.count;
        if (row.kind.endsWith('.issue')) item.issues += row.count;
        item.tokensIn += row.tokensIn;
        item.tokensOut += row.tokensOut;
        statistics.set(row.date, item);
      }
      for (const row of published) {
        const item = statistics.get(row.date) ?? {
          date: row.date,
          reviews: 0,
          issues: 0,
          published: 0,
          tokensIn: 0,
          tokensOut: 0,
        };
        item.published = row.count;
        statistics.set(row.date, item);
      }
      return {
        keyLast4: key?.last4 ?? null,
        style: style ?? {
          profileJson: DEFAULT_STYLE_PROFILE,
          profileMd: '',
          sourceCount: 0,
          pendingEditCount: 0,
        },
        usage,
        statistics: [...statistics.values()]
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 14),
      };
    },
    async setKey(userId: string, key: string) {
      z.string().min(10).max(512).parse(key);
      await db
        .insert(schema.userApiKeys)
        .values({ userId, keyEnc: encrypt(key, env.ENCRYPTION_KEY), last4: key.slice(-4) })
        .onConflictDoUpdate({
          target: schema.userApiKeys.userId,
          set: { keyEnc: encrypt(key, env.ENCRYPTION_KEY), last4: key.slice(-4) },
        });
      return { last4: key.slice(-4) };
    },
    async removeKey(userId: string) {
      await db.delete(schema.userApiKeys).where(eq(schema.userApiKeys.userId, userId));
      return { ok: true };
    },
    async saveStyle(userId: string, input: unknown) {
      const parsed = z
        .object({ profileMd: z.string().max(10000), profileJson: StyleProfile.optional() })
        .parse(input);
      await db
        .insert(schema.styleProfiles)
        .values({
          userId,
          profileJson: parsed.profileJson ?? DEFAULT_STYLE_PROFILE,
          profileMd: parsed.profileMd,
          sourceCount: 0,
        })
        .onConflictDoUpdate({
          target: schema.styleProfiles.userId,
          set: {
            profileMd: parsed.profileMd,
            ...(parsed.profileJson ? { profileJson: parsed.profileJson } : {}),
          },
        });
      return { ok: true };
    },
    async run(id: string) {
      const runId = randomUUID();
      const [job] = await db
        .update(schema.aiJobs)
        .set({
          status: 'running',
          error: null,
          attempts: sql`${schema.aiJobs.attempts}+1`,
          resultJson: sql`coalesce(${schema.aiJobs.resultJson}, '{}'::jsonb) || ${JSON.stringify({ _runId: runId })}::jsonb`,
        })
        .where(
          and(
            eq(schema.aiJobs.id, id),
            or(eq(schema.aiJobs.status, 'queued'), eq(schema.aiJobs.status, 'failed')),
            lt(schema.aiJobs.attempts, 2),
          ),
        )
        .returning();
      if (!job) return;
      const ownedRun = and(
        eq(schema.aiJobs.id, id),
        eq(schema.aiJobs.status, 'running'),
        sql`${schema.aiJobs.resultJson}->>'_runId' = ${runId}`,
      );
      const payload = job.payloadJson as Payload;
      let live = (job.resultJson ?? {}) as Record<string, unknown>;
      const previous = live as {
        usage?: { input: number; output: number; cacheHit: number };
        durationMs?: number;
      };
      const usage = {
        input: previous.usage?.input ?? 0,
        output: previous.usage?.output ?? 0,
        cacheHit: previous.usage?.cacheHit ?? 0,
      };
      const started = Date.now(),
        duration = () => Date.now() - started + (previous.durationMs ?? 0);
      const controller = new AbortController();
      let ticking = false;
      const heartbeat = setInterval(() => {
        if (ticking) return;
        ticking = true;
        void (async () => {
          const rows = await db
            .update(schema.aiJobs)
            .set({ updatedAt: new Date() })
            .where(ownedRun)
            .returning({ id: schema.aiJobs.id });
          if (!rows.length) controller.abort();
        })()
          .catch(() => {})
          .finally(() => {
            ticking = false;
          });
      }, 3000);
      const observe = (value: typeof usage) => {
        usage.input += value.input;
        usage.output += value.output;
        usage.cacheHit += value.cacheHit;
      };
      let writes = Promise.resolve();
      const progress = (value: Record<string, unknown>) => {
        live = {
          ...live,
          ...value,
          checkpoint: {
            ...((live.checkpoint ?? {}) as object),
            ...((value.checkpoint ?? {}) as object),
          },
          _runId: runId,
        };
        const snapshot = JSON.parse(JSON.stringify({ ...live, usage, durationMs: duration() }));
        writes = writes.then(async () => {
          if (controller.signal.aborted) throw new AppError('job_cancelled', 409);
          const changed = await db
            .update(schema.aiJobs)
            .set({ resultJson: snapshot })
            .where(ownedRun)
            .returning({ id: schema.aiJobs.id });
          if (!changed.length) {
            controller.abort();
            throw new AppError('job_cancelled', 409);
          }
        });
        return writes;
      };
      try {
        const [user] = await db.select().from(schema.users).where(eq(schema.users.id, job.userId));
        if (!user) throw new AppError('not_found', 404);
        const base = ctx.provider
          ? await ctx.provider(user.id, payload.billing, observe)
          : await resolveProvider(db, env, user.id, payload.billing, undefined, observe);
        const provider: typeof base = {
          async completeJSON(options) {
            if (controller.signal.aborted) throw new AppError('job_cancelled', 409);
            const response = await base.completeJSON({
              ...options,
              signal: options.signal
                ? AbortSignal.any([options.signal, controller.signal])
                : controller.signal,
            });
            if (controller.signal.aborted) throw new AppError('job_cancelled', 409);
            return response;
          },
        };
        let checkpoint = (live.checkpoint ?? {}) as Record<string, unknown>;
        if (job.kind === 'repository.scan') {
          const scanInput = RepositoryScanInput.parse(payload.input);
          const history = await db
            .select({ result: schema.aiJobs.resultJson })
            .from(schema.aiJobs)
            .where(
              and(
                eq(schema.aiJobs.userId, user.id),
                eq(schema.aiJobs.kind, 'repository.scan'),
                sql`${schema.aiJobs.payloadJson}->'input'->>'repo' = ${scanInput.repo}`,
              ),
            )
            .orderBy(desc(schema.aiJobs.createdAt))
            .limit(12);
          const batches: Record<string, unknown> = {};
          for (const old of history.reverse())
            Object.assign(
              batches,
              (old.result as { checkpoint?: { batches?: object } } | null)?.checkpoint?.batches ??
                {},
            );
          checkpoint = {
            ...checkpoint,
            batches: Object.fromEntries(
              [
                ...Object.entries(batches).filter(
                  ([key]) => !Object.hasOwn((checkpoint.batches ?? {}) as object, key),
                ),
                ...Object.entries((checkpoint.batches ?? {}) as object),
              ].slice(-200),
            ),
          };
          if (scanInput.planJobId) {
            const plan = await getJob(user.id, scanInput.planJobId);
            if (plan.kind !== 'repository.plan' || plan.status !== 'done')
              throw new AppError('scan_not_ready', 409);
            checkpoint.plan = RepositoryPlan.parse(plan.resultJson);
          }
        }
        const run: RunContext = {
          ...ctx,
          user,
          provider,
          lang: payload.lang,
          signal: controller.signal,
          checkpoint,
          onProgress: progress,
        };
        await progress({
          progress: {
            stage:
              job.kind === 'discovery.find'
                ? 'discovering'
                : job.kind === 'change.prepare'
                  ? 'generating'
                  : job.kind === 'review.run'
                    ? 'reviewing'
                    : 'starting',
          },
          checkpoint,
        });
        const changeInput =
          job.kind === 'change.prepare' ? PrepareChangeInput.parse(payload.input) : null;
        const result =
          job.kind === 'review.run'
            ? await runReview(run, payload.reviewSessionId!)
            : job.kind === 'rulecard.build'
              ? await buildRulecard(run, z.object({ repo: z.string() }).parse(payload.input).repo)
              : job.kind === 'discovery.find'
                ? await discoverProjects(run, payload.input)
                : job.kind === 'repository.plan'
                  ? await planRepository(run, payload.input)
                  : job.kind === 'repository.scan'
                    ? await scanRepository(run, payload.input)
                    : changeInput
                      ? await prepareCodeChange(
                          run,
                          await getScan(user.id, changeInput.scanJobId),
                          changeInput.findingId,
                          changeInput.instruction,
                          changeInput.scanJobId,
                        )
                      : await runAssistantTask(run, job.kind, payload.input);
        await writes;
        if (controller.signal.aborted) throw new AppError('job_cancelled', 409);
        await db
          .update(schema.aiJobs)
          .set({
            status: 'done',
            resultJson: {
              ...live,
              ...result,
              progress: { stage: 'done' },
              usage,
              durationMs: duration(),
            },
            error: null,
          })
          .where(ownedRun);
        return result;
      } catch (error) {
        await writes.catch(() => {});
        const code = controller.signal.aborted
          ? 'job_cancelled'
          : error instanceof AppError
            ? error.code
            : 'ai_job_failed';
        await db
          .update(schema.aiJobs)
          .set({
            status: code === 'job_cancelled' ? 'cancelled' : 'failed',
            error: code,
            resultJson: { ...live, usage, durationMs: duration(), usageComplete: false },
          })
          .where(ownedRun);
        if (payload.reviewSessionId) {
          const [latest] = await db
            .select({ result: schema.aiJobs.resultJson })
            .from(schema.aiJobs)
            .where(eq(schema.aiJobs.id, id));
          if ((latest?.result as { _runId?: string } | null)?._runId === runId)
            await db
              .update(schema.reviewSessions)
              .set({ status: 'failed', error: code })
              .where(eq(schema.reviewSessions.id, payload.reviewSessionId));
        }
        if (code === 'job_cancelled') return;
        throw new AppError(code, 502);
      } finally {
        clearInterval(heartbeat);
      }
    },
  };
}
export type AIService = ReturnType<typeof createAIService>;
