import { GitHub } from 'arctic';
import type { Environment } from '@openself/shared/env';
export function githubOAuth(env: Environment) {
  return new GitHub(
    env.GITHUB_CLIENT_ID,
    env.GITHUB_CLIENT_SECRET,
    `${env.APP_URL}/api/auth/github/callback`,
  );
}
