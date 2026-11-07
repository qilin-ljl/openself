import { beforeEach, describe, expect, it } from 'vitest';
import { createSessionService, type SessionRecord, type SessionStore } from './session';
describe('database-backed session lifecycle', () => {
  const records = new Map<string, SessionRecord>();
  const store: SessionStore = {
    async insert(record) {
      records.set(record.id, record);
    },
    async find(id) {
      return records.get(id) ?? null;
    },
    async remove(id) {
      records.delete(id);
    },
    async touch(id, date) {
      const record = records.get(id);
      if (record) records.set(id, { ...record, lastSeenAt: date });
    },
  };
  const service = createSessionService(store);
  const now = new Date('2026-11-06T12:00:00Z');
  beforeEach(() => records.clear());
  it('creates distinct unguessable tokens and restores their user', async () => {
    const a = await service.create('alice', 'web', now);
    const b = await service.create('alice', 'web', now);
    expect(a.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.id).not.toBe(b.id);
    expect((await service.validate(a.id, 'web', now))?.userId).toBe('alice');
  });
  it('rejects expired sessions and removes them', async () => {
    const record = await service.create('alice', 'web', now);
    expect(await service.validate(record.id, 'web', new Date('2026-12-06T12:00:00Z'))).toBeNull();
    expect(records.has(record.id)).toBe(false);
  });
  it('does not interchange extension tokens and web cookies', async () => {
    const record = await service.create('alice', 'extension', now);
    expect(await service.validate(record.id, 'web', now)).toBeNull();
  });
  it('updates activity at most once every five minutes', async () => {
    const record = await service.create('alice', 'web', now);
    await service.validate(record.id, 'web', new Date('2026-11-06T12:04:59Z'));
    expect(records.get(record.id)?.lastSeenAt).toEqual(now);
    await service.validate(record.id, 'web', new Date('2026-11-06T12:05:00Z'));
    expect(records.get(record.id)?.lastSeenAt).toEqual(new Date('2026-11-06T12:05:00Z'));
  });
  it('logout invalidates the token immediately', async () => {
    const record = await service.create('alice', 'web', now);
    await service.revoke(record.id);
    expect(await service.validate(record.id, 'web', now)).toBeNull();
  });
});
