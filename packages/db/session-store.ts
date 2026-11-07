import { eq } from 'drizzle-orm';
import type { Database } from './index';
import { sessions } from './schema';
export function databaseSessionStore(db: Database) {
  return {
    async insert(record: typeof sessions.$inferInsert) {
      await db.insert(sessions).values(record);
    },
    async find(id: string) {
      return (await db.select().from(sessions).where(eq(sessions.id, id)).limit(1))[0] ?? null;
    },
    async remove(id: string) {
      await db.delete(sessions).where(eq(sessions.id, id));
    },
    async touch(id: string, date: Date) {
      await db.update(sessions).set({ lastSeenAt: date }).where(eq(sessions.id, id));
    },
  };
}
