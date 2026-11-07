import { Queue, Worker } from 'bullmq';
import { createDatabase, eq, and, or, gte, asc, schema } from '@openself/db';
import { recoverAIJobs } from './job-recovery';
import type { Environment } from '@openself/shared/env';
import { createWorkspace } from './workspace';
import { createAIService } from './ai-service';
import { redisConnection } from './queue';
export function startAIWorkers(env: Environment) {
  const { db, close } = createDatabase(env.DATABASE_URL),
    workspace = createWorkspace(db, env),
    ai = createAIService({ db, env, workspace }),
    connection = redisConnection(env.REDIS_URL);
  const queues = new Map(
    ['review', 'rulecard', 'style', 'issue', 'discovery', 'repository', 'change'].map((name) => [
      name,
      new Queue(name, { connection }),
    ]),
  );
  for (const q of queues.values())
    q.on('error', () => console.error(JSON.stringify({ event: 'ai.queue_error' })));
  const workers = [...queues.keys()].map((name) => {
    const w = new Worker(
      name,
      async (job) => {
        await ai.run(String(job.data.jobId));
      },
      {
        connection,
        concurrency: ['discovery', 'repository', 'change'].includes(name)
          ? 1
          : name === 'review'
            ? 2
            : 3,
      },
    );
    w.on('error', () => console.error(JSON.stringify({ event: 'ai.worker_error', queue: name })));
    w.on('failed', (job) => console.error(JSON.stringify({ event: 'ai.job_failed', id: job?.id })));
    return w;
  });
  let scanning = false;
  async function reconcile() {
    if (scanning) return;
    scanning = true;
    try {
      await recoverAIJobs(db);
      const jobs = await db
        .select()
        .from(schema.aiJobs)
        .where(eq(schema.aiJobs.status, 'queued'))
        .orderBy(asc(schema.aiJobs.updatedAt))
        .limit(100);
      for (const job of jobs) {
        const name = job.kind === 'translate' ? 'issue' : job.kind.split('.')[0]!;
        await queues.get(name)?.add(
          job.kind,
          { jobId: job.id },
          {
            jobId: job.id,
            attempts: 2,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: true,
            removeOnFail: true,
          },
        );
      }
      const profiles = await db
        .select()
        .from(schema.styleProfiles)
        .where(gte(schema.styleProfiles.pendingEditCount, 20));
      for (const profile of profiles) {
        const [user] = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, profile.userId));
        const active = await db
          .select()
          .from(schema.aiJobs)
          .where(
            and(
              eq(schema.aiJobs.userId, profile.userId),
              eq(schema.aiJobs.kind, 'style.build'),
              or(eq(schema.aiJobs.status, 'queued'), eq(schema.aiJobs.status, 'running')),
            ),
          );
        if (user && !active.length)
          try {
            await ai.rebuildStyle(user);
          } catch {
            /* Missing keys or exhausted quota can wait for a later scan. */
          }
      }
    } catch {
      console.error(JSON.stringify({ event: 'ai.reconcile_failed' }));
    } finally {
      scanning = false;
    }
  }
  const timer = setInterval(() => void reconcile(), 30000);
  void reconcile();
  return {
    async close() {
      clearInterval(timer);
      await Promise.all(workers.map((w) => w.close()));
      await Promise.all([...queues.values()].map((q) => q.close()));
      await close();
    },
  };
}
