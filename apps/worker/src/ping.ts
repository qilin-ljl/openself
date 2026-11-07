import { config } from 'dotenv';
import { QueueEvents } from 'bullmq';
import { parseEnv } from '@openself/shared/env';
import { createPingQueue, redisConnection } from '@openself/core/queue';
config({ path: '../../.env', quiet: true });
const env = parseEnv(process.env);
const queue = createPingQueue(env.REDIS_URL);
const events = new QueueEvents('health', { connection: redisConnection(env.REDIS_URL) });
try {
  await events.waitUntilReady();
  const job = await queue.add('ping', {});
  console.info(await job.waitUntilFinished(events, 10000));
} finally {
  await queue.close();
  await events.close();
}
