import { Queue, Worker } from 'bullmq';
import { createDatabase, eq, asc, schema } from '@openself/db';
import type { Environment } from '@openself/shared/env';
import { createWorkspace } from './workspace';
import { redisConnection } from './queue';
export function startPublishWorker(env: Environment) {
  const { db, close } = createDatabase(env.DATABASE_URL),
    workspace = createWorkspace(db, env),
    connection = redisConnection(env.REDIS_URL);
  const queue = new Queue('publish', { connection });
  queue.on('error', () => console.error(JSON.stringify({ event: 'publish.queue_error' })));
  const worker = new Worker(
    'publish',
    async (job) => {
      if (job.name !== 'draft.publish' || typeof job.data.draftId !== 'string')
        throw new Error('Invalid publication job');
      await workspace.drafts.publish(job.data.draftId);
    },
    { connection, concurrency: 3 },
  );
  worker.on('error', () => console.error(JSON.stringify({ event: 'publish.connection_error' })));
  worker.on('failed', (job) =>
    console.error(JSON.stringify({ event: 'publish.failed', jobId: job?.id })),
  );
  let scanning = false;
  async function reconcile() {
    if (scanning) return;
    scanning = true;
    try {
      const approved = await db
        .select({ id: schema.drafts.id })
        .from(schema.drafts)
        .where(eq(schema.drafts.status, 'approved'))
        .orderBy(asc(schema.drafts.updatedAt))
        .limit(100);
      for (const { id } of approved)
        await queue.add(
          'draft.publish',
          { draftId: id },
          { jobId: id, attempts: 1, removeOnComplete: true, removeOnFail: true },
        );
    } catch {
      console.error(JSON.stringify({ event: 'publish.reconcile_failed' }));
    } finally {
      scanning = false;
    }
  }
  const timer = setInterval(() => void reconcile(), 30000);
  void reconcile();
  return {
    async close() {
      clearInterval(timer);
      await worker.close();
      await queue.close();
      await close();
    },
  };
}
