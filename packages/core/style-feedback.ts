import { type Database, schema, sql } from '@openself/db';
import { DEFAULT_STYLE_PROFILE } from '@openself/shared/ai';
export async function recordEdit(
  db: Database,
  userId: string,
  source: 'finding' | 'issue',
  before: string,
  after: string,
) {
  if (before === after) return;
  await db.transaction(async (tx) => {
    await tx.insert(schema.draftEdits).values({ userId, source, before, after });
    await tx
      .insert(schema.styleProfiles)
      .values({
        userId,
        profileJson: DEFAULT_STYLE_PROFILE,
        profileMd: '',
        sourceCount: 0,
        pendingEditCount: 1,
      })
      .onConflictDoUpdate({
        target: schema.styleProfiles.userId,
        set: { pendingEditCount: sql`${schema.styleProfiles.pendingEditCount}+1` },
      });
  });
}
