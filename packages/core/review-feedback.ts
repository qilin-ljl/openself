import { type Database, eq, and, schema } from '@openself/db';
import type { ReviewPayload } from '@openself/shared/api';
import { AppError } from '@openself/shared/errors';
import { recordEdit } from './style-feedback';
export async function validateAIReview(
  db: Database,
  userId: string,
  repo: string,
  n: number,
  payload: ReviewPayload,
) {
  if (!payload.reviewSessionId) {
    if (payload.comments.some((c) => c.findingId)) throw new AppError('validation', 400);
    return;
  }
  const [session] = await db
    .select()
    .from(schema.reviewSessions)
    .where(
      and(
        eq(schema.reviewSessions.id, payload.reviewSessionId),
        eq(schema.reviewSessions.userId, userId),
        eq(schema.reviewSessions.repoFullName, repo),
        eq(schema.reviewSessions.prNumber, n),
      ),
    );
  if (!session) throw new AppError('not_found', 404);
  if (session.headSha !== payload.headSha) throw new AppError('stale_head', 409);
  const findings = await db
    .select({ id: schema.reviewFindings.id })
    .from(schema.reviewFindings)
    .where(eq(schema.reviewFindings.sessionId, session.id));
  if (payload.comments.some((c) => c.findingId && !findings.some((f) => f.id === c.findingId)))
    throw new AppError('validation', 400);
}
export async function recordReviewFeedback(
  db: Database,
  userId: string,
  payload: ReviewPayload,
  before?: ReviewPayload,
) {
  if (!payload.reviewSessionId) return;
  const findings = await db
    .select()
    .from(schema.reviewFindings)
    .where(eq(schema.reviewFindings.sessionId, payload.reviewSessionId));
  for (const comment of payload.comments) {
    const f = findings.find((f) => f.id === comment.findingId);
    if (!f) continue;
    const previous =
      before?.comments.find((c) => c.findingId === comment.findingId)?.body ??
      f.body + (f.suggestion ? '\n\n```suggestion\n' + f.suggestion + '\n```' : '');
    await recordEdit(db, userId, 'finding', previous, comment.body);
  }
}
