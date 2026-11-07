import { type Database, eq, and, lt, schema } from '@openself/db';
export async function recoverAIJobs(db: Database, now = new Date()) {
  const expired = await db
    .select()
    .from(schema.aiJobs)
    .where(
      and(
        eq(schema.aiJobs.status, 'running'),
        lt(schema.aiJobs.updatedAt, new Date(now.getTime() - 15 * 60000)),
      ),
    );
  for (const job of expired) {
    const retry = job.attempts < 2;
    const changed = await db
      .update(schema.aiJobs)
      .set({ status: retry ? 'queued' : 'failed', error: retry ? null : 'worker_interrupted' })
      .where(
        and(
          eq(schema.aiJobs.id, job.id),
          eq(schema.aiJobs.status, 'running'),
          lt(schema.aiJobs.updatedAt, new Date(now.getTime() - 15 * 60000)),
        ),
      )
      .returning({ id: schema.aiJobs.id });
    if (!changed.length) continue;
    const payload = job.payloadJson as { reviewSessionId?: string };
    if (payload.reviewSessionId)
      await db
        .update(schema.reviewSessions)
        .set({ status: retry ? 'queued' : 'failed', error: retry ? null : 'worker_interrupted' })
        .where(
          and(
            eq(schema.reviewSessions.id, payload.reviewSessionId),
            eq(schema.reviewSessions.userId, job.userId),
          ),
        );
  }
}
