import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
export function createDatabase(url: string) {
  const client = postgres(url, { max: 5, connect_timeout: 10 });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}
export type Database = ReturnType<typeof createDatabase>['db'];
export { eq, and, or, lt, gte, desc, asc, sql, inArray, count, ne, isNull } from 'drizzle-orm';
export { schema };
