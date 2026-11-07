import { parseEnv } from '@openself/shared/env';
import { createDatabase } from '@openself/db';
import { databaseSessionStore } from '@openself/db/session-store';
import { createSessionService } from '@openself/core/session';
import { getTestContext } from './test-context';
let runtime: ReturnType<typeof initialize> | undefined;
function initialize() {
  const env = parseEnv(process.env);
  const { db } = createDatabase(env.DATABASE_URL);
  return { env, db, sessions: createSessionService(databaseSessionStore(db)) };
}
export function getRuntime() {
  const test = getTestContext();
  if (test) return test;
  return (runtime ??= initialize());
}
