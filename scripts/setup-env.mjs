import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const target = new URL('../.env', import.meta.url);
if (existsSync(target)) {
  console.info('Existing .env preserved.');
} else {
  const template = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  writeFileSync(
    target,
    template.replace('ENCRYPTION_KEY=', `ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`),
    { mode: 0o600 },
  );
  console.info(
    'Created local .env with an encryption key. GitHub credentials still need configuration.',
  );
}
