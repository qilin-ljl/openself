import { type Database, schema, eq, and, desc, inArray, gte, sql } from '@openself/db';
import { CreateDraft, IssuePayload, ReviewPayload, DraftDTO } from '@openself/shared/api';
import { prepareReview } from './prepare-review';
import { AppError } from '@openself/shared/errors';
import type { Environment } from '@openself/shared/env';
import type { GitHubClient } from '@openself/github';
import { randomUUID, createHash } from 'node:crypto';
import { buildFormBody } from '@openself/github/templates';
import { recordEdit } from './style-feedback';
import { validateAIReview, recordReviewFeedback } from './review-feedback';
import { preparePullRequestPayload, publishPreparedPullRequest } from './pull-request-publishing';
import { PullRequestPayload } from '@openself/shared/contributions';
export type Draft = typeof schema.drafts.$inferSelect;
export type User = typeof schema.users.$inferSelect;
export interface DraftDependencies {
  db: Database;
  env: Environment;
  githubFor: (userId: string) => Promise<GitHubClient>;
  enqueue: (draftId: string) => Promise<void>;
}
export function draftDTO(draft: Draft): DraftDTO {
  return DraftDTO.parse({
    ...draft,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  });
}
export function dayStart(now: Date) {
  return new Date(Math.floor((now.getTime() + 8 * 3600000) / 86400000) * 86400000 - 8 * 3600000);
}
export function createDraftService(deps: DraftDependencies) {
  const { db } = deps;
  async function find(userId: string, id: string) {
    const [draft] = await db
      .select()
      .from(schema.drafts)
      .where(and(eq(schema.drafts.id, id), eq(schema.drafts.userId, userId)));
    if (!draft) throw new AppError('not_found', 404);
    return draft;
  }
  async function validateIssue(user: User, repo: string, payload: IssuePayload) {
    const [owner, name] = repo.split('/') as [string, string];
    const github = await deps.githubFor(user.id);
    const repository = await github.getRepo(owner, name, true);
    if (repository.private && !user.privateRepoEnabled)
      throw new AppError('private_repo_disabled', 403);
    if (repository.archived || !repository.has_issues)
      throw new AppError('issues_unavailable', 409);
    const templates = await github.listIssueTemplates(owner, name);
    if (!payload.templateId && !templates.blankIssuesEnabled)
      throw new AppError('template_required', 400);
    if (payload.templateId) {
      const template = templates.templates.find((t) => t.id === payload.templateId);
      if (!template) throw new AppError('template_not_found', 400);
      if (template.kind === 'form')
        payload = { ...payload, body: buildFormBody(template, payload.answers ?? {}) };
      payload = { ...payload, labels: repository.permissions?.push ? template.labels : [] };
    }
    return { ...payload, labels: repository.permissions?.push ? payload.labels : [] };
  }
  return {
    find,
    async list(userId: string, status?: Draft['status']) {
      return db
        .select()
        .from(schema.drafts)
        .where(
          and(
            eq(schema.drafts.userId, userId),
            status ? eq(schema.drafts.status, status) : undefined,
          ),
        )
        .orderBy(desc(schema.drafts.updatedAt))
        .limit(100);
    },
    async create(user: User, input: unknown) {
      const parsed = CreateDraft.parse(input);
      const payload =
        parsed.kind === 'issue'
          ? await validateIssue(user, parsed.repo, parsed.payload)
          : parsed.kind === 'review'
            ? await prepareReview(
                await deps.githubFor(user.id),
                user,
                parsed.repo,
                parsed.prNumber,
                parsed.payload,
              )
            : await preparePullRequestPayload(db, user, parsed.repo, parsed.payload);
      if (parsed.kind === 'review') {
        await validateAIReview(db, user.id, parsed.repo, parsed.prNumber, payload as ReviewPayload);
        if ((payload as ReviewPayload).reviewSessionId) payload.aiGenerated = true;
      }
      const [draft] = await db
        .insert(schema.drafts)
        .values({
          userId: user.id,
          kind: parsed.kind,
          targetNumber: parsed.kind === 'review' ? parsed.prNumber : null,
          repoFullName: parsed.repo,
          payloadJson: payload,
          idempotencyKey: randomUUID(),
        })
        .returning();
      if (parsed.kind === 'review')
        await recordReviewFeedback(db, user.id, payload as ReviewPayload);
      return draft!;
    },
    async update(user: User, id: string, input: unknown) {
      const existing = await find(user.id, id);
      if (
        !['draft', 'failed'].includes(existing.status) ||
        existing.error === 'publication_unknown'
      )
        throw new AppError('draft_locked', 409);
      const payload =
        existing.kind === 'issue'
          ? await validateIssue(user, existing.repoFullName, IssuePayload.parse(input))
          : existing.kind === 'review'
            ? await prepareReview(
                await deps.githubFor(user.id),
                user,
                existing.repoFullName,
                existing.targetNumber!,
                ReviewPayload.parse(input),
              )
            : await preparePullRequestPayload(db, user, existing.repoFullName, input);
      if (existing.kind === 'review') {
        await validateAIReview(
          db,
          user.id,
          existing.repoFullName,
          existing.targetNumber!,
          payload as ReviewPayload,
        );
        if ((payload as ReviewPayload).reviewSessionId) payload.aiGenerated = true;
      }
      const [saved] = await db
        .update(schema.drafts)
        .set({ payloadJson: payload, status: 'draft', error: null })
        .where(
          and(
            eq(schema.drafts.id, id),
            eq(schema.drafts.userId, user.id),
            inArray(schema.drafts.status, ['draft', 'failed']),
          ),
        )
        .returning();
      if (!saved) throw new AppError('draft_locked', 409);
      if (existing.kind === 'review')
        await recordReviewFeedback(
          db,
          user.id,
          payload as ReviewPayload,
          ReviewPayload.parse(existing.payloadJson),
        );
      if (existing.kind === 'issue' && IssuePayload.parse(existing.payloadJson).aiGenerated)
        await recordEdit(
          db,
          user.id,
          'issue',
          IssuePayload.parse(existing.payloadJson).body,
          payload.body,
        );
      return saved;
    },
    async discard(userId: string, id: string) {
      const [draft] = await db
        .update(schema.drafts)
        .set({ status: 'discarded' })
        .where(
          and(
            eq(schema.drafts.id, id),
            eq(schema.drafts.userId, userId),
            inArray(schema.drafts.status, ['draft', 'failed']),
          ),
        )
        .returning();
      if (!draft) throw new AppError('draft_locked', 409);
      return draft;
    },
    async approve(userId: string, id: string) {
      const existing = await find(userId, id);
      if (!['draft', 'approved'].includes(existing.status)) throw new AppError('draft_locked', 409);
      await db
        .update(schema.drafts)
        .set({ status: 'approved', error: null })
        .where(and(eq(schema.drafts.id, id), eq(schema.drafts.status, 'draft')));
      try {
        await deps.enqueue(id);
      } catch {
        throw new AppError('queue_unavailable', 503);
      } // The approved row is a durable outbox; the worker reconciles it.
      return find(userId, id);
    },
    async publish(id: string, now = new Date()) {
      const [initial] = await db.select().from(schema.drafts).where(eq(schema.drafts.id, id));
      if (!initial) return;
      const claimed = await db.transaction(async (tx) => {
        const [user] = await tx
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, initial.userId))
          .for('update');
        const [draft] = await tx
          .select()
          .from(schema.drafts)
          .where(eq(schema.drafts.id, id))
          .for('update');
        if (!user || !draft || draft.status !== 'approved') return null;
        const reserved = await tx
          .select()
          .from(schema.drafts)
          .where(
            and(
              eq(schema.drafts.userId, user.id),
              eq(schema.drafts.kind, 'issue'),
              inArray(schema.drafts.status, ['publishing', 'published']),
              gte(
                schema.drafts.updatedAt,
                new Date(Math.min(now.getTime() - 3600000, dayStart(now).getTime())),
              ),
            ),
          );
        if (
          draft.kind === 'issue' &&
          (reserved.filter((d) => d.updatedAt.getTime() >= now.getTime() - 3600000).length >= 10 ||
            reserved.filter(
              (d) => d.repoFullName === draft.repoFullName && d.updatedAt >= dayStart(now),
            ).length >= 5)
        ) {
          await tx
            .update(schema.drafts)
            .set({ error: 'rate_limited' })
            .where(eq(schema.drafts.id, id));
          return null;
        }
        await tx
          .update(schema.drafts)
          .set({ status: 'publishing', error: null, updatedAt: now })
          .where(eq(schema.drafts.id, id));
        return { draft, user };
      });
      if (!claimed) return;
      let sent = false,
        confirmedMutation = false;
      try {
        const { draft, user } = claimed;
        const [owner, repo] = draft.repoFullName.split('/') as [string, string];
        const payload =
          draft.kind === 'review'
            ? await prepareReview(
                await deps.githubFor(user.id),
                user,
                draft.repoFullName,
                draft.targetNumber!,
                ReviewPayload.parse(draft.payloadJson),
              )
            : draft.kind === 'pull_request'
              ? await preparePullRequestPayload(db, user, draft.repoFullName, draft.payloadJson)
              : await validateIssue(
                  user,
                  draft.repoFullName,
                  IssuePayload.parse(draft.payloadJson),
                );
        if (draft.kind === 'issue' && payload.body !== IssuePayload.parse(draft.payloadJson).body)
          throw new AppError('template_changed', 409);
        let body = payload.body;
        if (user.aiDisclosure && payload.aiGenerated)
          body +=
            user.locale === 'zh'
              ? `\n\n---\n<sub>本内容由 OpenSelf AI 辅助起草，经 @${user.login} 审核后发布。</sub>`
              : `\n\n---\n<sub>Drafted with AI assistance via OpenSelf and reviewed by @${user.login}.</sub>`;
        const github = await deps.githubFor(user.id);
        if (draft.kind !== 'pull_request') sent = true;
        const result =
          draft.kind === 'review'
            ? await github.submitReview(owner, repo, draft.targetNumber!, {
                commit_id: (payload as ReviewPayload).headSha,
                event: (payload as ReviewPayload).event,
                body,
                comments: (payload as ReviewPayload).comments,
              })
            : draft.kind === 'pull_request'
              ? await publishPreparedPullRequest(
                  github,
                  user,
                  draft.id,
                  PullRequestPayload.parse({ ...payload, body }),
                  (phase) => {
                    sent = true;
                    if (phase === 'confirmed') confirmedMutation = true;
                  },
                )
              : await github.createIssue(owner, repo, {
                  title: payload.title,
                  body,
                  labels: (payload as IssuePayload).labels,
                });
        await db.transaction(async (tx) => {
          await tx
            .update(schema.drafts)
            .set({ status: 'published', githubUrl: result.url, error: null, updatedAt: now })
            .where(eq(schema.drafts.id, id));
          await tx.insert(schema.auditLog).values({
            userId: user.id,
            action:
              draft.kind === 'review'
                ? 'review.submit'
                : draft.kind === 'pull_request'
                  ? 'pull_request.create'
                  : 'issue.create',
            repoFullName: draft.repoFullName,
            target: String(draft.kind === 'review' ? draft.targetNumber : result.number),
            githubUrl: result.url,
            payloadHash: createHash('sha256')
              .update(JSON.stringify({ ...payload, body }))
              .digest('hex'),
          });
        });
      } catch (error) {
        const known = error instanceof AppError;
        const uncertain =
          sent &&
          (!known ||
            error.code === 'unknown' ||
            (initial.kind === 'pull_request' && confirmedMutation));
        await db
          .update(schema.drafts)
          .set({
            status: uncertain ? 'publishing' : 'failed',
            error: uncertain ? 'publication_unknown' : known ? error.code : 'service_unavailable',
          })
          .where(eq(schema.drafts.id, id));
      }
    },
    async audit(userId: string, page = 1) {
      return db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.userId, userId))
        .orderBy(desc(schema.auditLog.createdAt))
        .limit(20)
        .offset((page - 1) * 20);
    },
    async counts(userId: string) {
      const [result] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.drafts)
        .where(
          and(
            eq(schema.drafts.userId, userId),
            inArray(schema.drafts.status, ['draft', 'approved', 'publishing', 'failed']),
          ),
        );
      return result?.count ?? 0;
    },
  };
}
