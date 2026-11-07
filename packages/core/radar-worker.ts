import { Queue, Worker } from 'bullmq';
import { createDatabase, eq, schema } from '@openself/db';
import type { Environment } from '@openself/shared/env';
import { createWorkspace } from './workspace';
import { createRadar } from './radar';
import { redisConnection } from './queue';
export function startRadarWorker(env: Environment) {
  const { db, close } = createDatabase(env.DATABASE_URL),
    radar = createRadar(db, createWorkspace(db, env)),
    connection = redisConnection(env.REDIS_URL),
    queue = new Queue('radar', { connection });
  queue.on('error', () => console.error(JSON.stringify({ event: 'radar.queue_error' })));
  const worker = new Worker(
    'radar',
    async () => {
      for (const { id } of await radar.activeUsers()) {
        const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id));
        if (user)
          try {
            await radar.get(user, true);
          } catch {
            console.error(JSON.stringify({ event: 'radar.user_failed', userId: id }));
          }
      }
    },
    { connection, concurrency: 1 },
  );
  worker.on('error', () => console.error(JSON.stringify({ event: 'radar.worker_error' })));
  worker.on('failed', () => console.error(JSON.stringify({ event: 'radar.job_failed' })));
  void queue
    .upsertJobScheduler(
      'daily',
      { pattern: '0 7 * * *', tz: 'Asia/Shanghai' },
      { name: 'radar.daily', data: {}, opts: { removeOnComplete: 30, removeOnFail: 30 } },
    )
    .catch(() => console.error(JSON.stringify({ event: 'radar.schedule_failed' })));
  return {
    async close() {
      await worker.close();
      await queue.close();
      await close();
    },
  };
}
