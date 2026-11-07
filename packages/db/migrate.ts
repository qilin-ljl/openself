import { config } from 'dotenv';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { fileURLToPath } from 'node:url';
config({ path: '../../.env', quiet: true });
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client);
let locked = false;
try {
  await client`select pg_advisory_lock(871042111)`;
  locked = true;
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('./migrations', import.meta.url)) });
  console.info('Migrations applied');
} finally {
  if (locked) await client`select pg_advisory_unlock(871042111)`;
  await client.end();
}
