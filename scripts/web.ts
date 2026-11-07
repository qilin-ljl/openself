import { config } from 'dotenv';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { parseEnv } from '../packages/shared/env';
config({ path: '../../.env', quiet: true });
try {
  parseEnv(process.env);
} catch (error) {
  console.error(String(error));
  console.error('Complete the root .env first. Use pnpm preview for the public landing page only.');
  process.exit(1);
}
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const child = spawn(
  process.execPath,
  [require.resolve('next/dist/bin/next'), ...process.argv.slice(2)],
  { stdio: 'inherit', env: process.env },
);
child.on('exit', (code) => process.exit(code ?? 1));
