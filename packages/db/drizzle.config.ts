import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';
config({ path: '../../.env', quiet: true });
export default defineConfig({
  schema: './schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
