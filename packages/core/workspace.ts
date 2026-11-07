import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { type Database, eq, schema } from '@openself/db';
import type { Environment } from '@openself/shared/env';
import { AppError } from '@openself/shared/errors';
import { createGitHubClient, type GitHubClient, type CacheStore } from '@openself/github';
import { decrypt } from './crypto';
import { createDraftService, type User } from './drafts';
import { redisConnection } from './queue';
export interface Workspace {
  githubFor(userId: string): Promise<GitHubClient>;
  drafts: ReturnType<typeof createDraftService>;
  assertRepo(
    user: User,
    owner: string,
    repo: string,
  ): Promise<Awaited<ReturnType<GitHubClient['getRepo']>>>;
}
export function createWorkspace(
  db: Database,
  env: Environment,
  options: {
    cache?: CacheStore;
    enqueue?: (id: string) => Promise<void>;
    fetch?: typeof fetch;
  } = {},
): Workspace {
  let redis: Redis | undefined;
  let queue: Queue | undefined;
  function cacheClient() {
    if (!redis) {
      redis = new Redis(env.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 1500,
        retryStrategy: () => null,
      });
      redis.on('error', () => {});
    }
    return redis;
  }
  const cache = options.cache ?? {
    get: (key: string) => cacheClient().get(key),
    async set(key: string, value: string, ttl: number) {
      await cacheClient().set(key, value, 'EX', ttl);
    },
  };
  async function githubFor(userId: string) {
    const [credential] = await db
      .select()
      .from(schema.oauthTokens)
      .where(eq(schema.oauthTokens.userId, userId));
    if (!credential) throw new AppError('unauthorized', 401);
    return createGitHubClient(decrypt(credential.accessTokenEnc, env.ENCRYPTION_KEY), {
      userId,
      cache,
      fetch: options.fetch,
      onUnauthorized: async () => {
        await db.transaction(async (tx) => {
          await tx.delete(schema.oauthTokens).where(eq(schema.oauthTokens.userId, userId));
          await tx.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
        });
      },
    });
  }
  const enqueue =
    options.enqueue ??
    (async (id: string) => {
      if (!queue) {
        queue = new Queue('publish', {
          connection: {
            ...redisConnection(env.REDIS_URL),
            maxRetriesPerRequest: 1,
            connectTimeout: 2000,
            retryStrategy: () => null,
          },
        });
        queue.on('error', () => {});
      }
      await queue.add(
        'draft.publish',
        { draftId: id },
        { jobId: id, attempts: 1, removeOnComplete: true, removeOnFail: true },
      );
    });
  const drafts = createDraftService({ db, env, githubFor, enqueue });
  return {
    githubFor,
    drafts,
    async assertRepo(user, owner, repo) {
      const repository = await (await githubFor(user.id)).getRepo(owner, repo);
      if (repository.private && !user.privateRepoEnabled)
        throw new AppError('private_repo_disabled', 403);
      return repository;
    },
  };
}
