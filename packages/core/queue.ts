import { Queue } from 'bullmq';
export function redisConnection(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: Number(parsed.pathname.slice(1) || 0),
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}
export function createPingQueue(redisUrl: string) {
  return new Queue('health', {
    connection: redisConnection(redisUrl),
    defaultJobOptions: { removeOnComplete: 100, removeOnFail: 100 },
  });
}
