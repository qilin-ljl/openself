import { config } from 'dotenv';
import { Worker } from 'bullmq';
import { parseEnv } from '@openself/shared/env';
import { redisConnection } from '@openself/core/queue';
import { startPublishWorker } from '@openself/core/worker';
import { startAIWorkers } from '@openself/core/ai-worker';
import { startRadarWorker } from '@openself/core/radar-worker';
config({ path: '../../.env', quiet: true });
const env = parseEnv(process.env);
const publisher = startPublishWorker(env);
const ai = startAIWorkers(env);
const radar = startRadarWorker(env);
const worker = new Worker(
  'health',
  async (job) => {
    if (job.name !== 'ping') throw new Error('Unknown health job');
    return {
      ok: true,
      processedAt: new Date().toISOString(),
      publicationMode: 'github-permissions',
    };
  },
  { connection: redisConnection(env.REDIS_URL), concurrency: 1 },
);
worker.on('completed', (job) =>
  console.info(JSON.stringify({ event: 'job.completed', id: job.id, name: job.name })),
);
worker.on('failed', (job) =>
  console.error(JSON.stringify({ event: 'job.failed', id: job?.id, name: job?.name })),
);
worker.on('error', () => console.error(JSON.stringify({ event: 'worker.connection_error' })));
async function shutdown() {
  await radar.close();
  await ai.close();
  await publisher.close();
  await worker.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
console.info('OpenSelf health worker started');
