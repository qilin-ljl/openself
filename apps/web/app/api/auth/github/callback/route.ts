import { NextRequest, NextResponse } from 'next/server';
import { safeNext, validState } from '@openself/core/auth-policy';
import { encrypt } from '@openself/core/crypto';
import { eq, schema } from '@openself/db';
import { getRuntime } from '../../../../../lib/runtime';
import { githubOAuth } from '../../../../../lib/github-auth';
import { apiError, cookieOptions } from '../../../../../lib/api';
import { GitHubProfile } from '@openself/shared/api';
export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get('state');
  const code = request.nextUrl.searchParams.get('code');
  if (!code || !validState(request.cookies.get('os_oauth_state')?.value, state)) {
    const response = apiError('invalid_oauth_state', 400);
    response.cookies.delete('os_oauth_state');
    response.cookies.delete('os_oauth_next');
    return response;
  }
  try {
    const { env, db, sessions } = getRuntime();
    const next = safeNext(request.cookies.get('os_oauth_next')?.value);
    const locale = next.startsWith('/en') ? 'en' : 'zh';
    const response = NextResponse.redirect(new URL(next, env.APP_URL));
    response.cookies.delete('os_oauth_state');
    response.cookies.delete('os_oauth_next');
    try {
      const tokens = await githubOAuth(env).validateAuthorizationCode(code);
      const accessToken = tokens.accessToken();
      const githubResponse = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'OpenSelf/0.0.1',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      if (!githubResponse.ok) throw new Error('GitHub identity unavailable');
      const profile = GitHubProfile.parse(await githubResponse.json());
      const privateRepoEnabled =
        request.cookies.get('os_oauth_private')?.value === '1' && tokens.scopes().includes('repo');
      const user = await db.transaction(async (tx) => {
        const [saved] = await tx
          .insert(schema.users)
          .values({
            githubId: profile.id,
            login: profile.login,
            name: profile.name,
            avatarUrl: profile.avatar_url,
            locale,
            privateRepoEnabled,
          })
          .onConflictDoUpdate({
            target: schema.users.githubId,
            set: {
              login: profile.login,
              name: profile.name,
              avatarUrl: profile.avatar_url,
              privateRepoEnabled,
            },
          })
          .returning();
        if (!saved) throw new Error('Identity persistence failed');
        const encrypted = encrypt(accessToken, env.ENCRYPTION_KEY);
        await tx
          .insert(schema.oauthTokens)
          .values({
            userId: saved.id,
            accessTokenEnc: encrypted,
            scopes: tokens.scopes().join(' '),
          })
          .onConflictDoUpdate({
            target: schema.oauthTokens.userId,
            set: { accessTokenEnc: encrypted, scopes: tokens.scopes().join(' ') },
          });
        return saved;
      });
      const previous = request.cookies.get(env.SESSION_COOKIE_NAME)?.value;
      if (previous) await sessions.revoke(previous);
      const session = await sessions.create(user.id);
      response.cookies.set(env.SESSION_COOKIE_NAME, session.id, {
        ...cookieOptions(new URL(env.APP_URL).protocol === 'https:'),
        expires: session.expiresAt,
      });
      response.cookies.set('NEXT_LOCALE', user.locale, {
        path: '/',
        sameSite: 'lax',
        secure: new URL(env.APP_URL).protocol === 'https:',
        maxAge: 365 * 86400,
      });
      response.headers.set('Cache-Control', 'no-store');
      response.cookies.delete('os_oauth_private');
      const [personalKey] = await db
        .select({ userId: schema.userApiKeys.userId })
        .from(schema.userApiKeys)
        .where(eq(schema.userApiKeys.userId, user.id));
      if (personalKey) {
        try {
          const { getAI } = await import('../../../../../lib/ai');
          const settings = await getAI().settings(user.id);
          if (settings.style.sourceCount === 0 && !settings.style.profileMd)
            await getAI().rebuildStyle(user);
        } catch {
          /* Login remains usable if background AI is unavailable. */
        }
      }
      return response;
    } catch {
      const failure = NextResponse.redirect(new URL(`/${locale}?error=oauth_failed`, env.APP_URL));
      failure.cookies.delete('os_oauth_state');
      failure.cookies.delete('os_oauth_next');
      return failure;
    }
  } catch {
    return apiError('configuration_unavailable', 503);
  }
}
