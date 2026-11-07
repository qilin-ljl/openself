import { randomBytes } from 'node:crypto';
export interface SessionRecord {
  id: string;
  userId: string;
  kind: 'web' | 'extension';
  expiresAt: Date;
  lastSeenAt: Date;
}
export interface SessionStore {
  insert(record: SessionRecord): Promise<void>;
  find(id: string): Promise<SessionRecord | null>;
  remove(id: string): Promise<void>;
  touch(id: string, date: Date): Promise<void>;
}
export function createSessionService(store: SessionStore) {
  return {
    async create(
      userId: string,
      kind: 'web' | 'extension' = 'web',
      now = new Date(),
    ): Promise<SessionRecord> {
      const record: SessionRecord = {
        id: randomBytes(32).toString('base64url'),
        userId,
        kind,
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        lastSeenAt: now,
      };
      await store.insert(record);
      return record;
    },
    async validate(
      id: string | undefined,
      kind: 'web' | 'extension' = 'web',
      now = new Date(),
    ): Promise<SessionRecord | null> {
      if (!id || !/^[A-Za-z0-9_-]{43}$/.test(id)) return null;
      const record = await store.find(id);
      if (!record || record.kind !== kind) return null;
      if (record.expiresAt.getTime() <= now.getTime()) {
        await store.remove(id);
        return null;
      }
      if (now.getTime() - record.lastSeenAt.getTime() >= 5 * 60 * 1000) await store.touch(id, now);
      return record;
    },
    async revoke(id: string): Promise<void> {
      await store.remove(id);
    },
  };
}
