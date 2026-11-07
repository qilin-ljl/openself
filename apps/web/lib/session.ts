import { cache } from 'react';
import { cookies } from 'next/headers';
import { eq, schema } from '@openself/db';
import { getRuntime } from './runtime';
export const currentUser = cache(async () => {
  const token = (await cookies()).get(process.env.SESSION_COOKIE_NAME || 'os_session')?.value;
  if (!token) return null;
  const { db, sessions } = getRuntime();
  const session = await sessions.validate(token);
  if (!session) return null;
  return (
    (await db.select().from(schema.users).where(eq(schema.users.id, session.userId)).limit(1))[0] ??
    null
  );
});
