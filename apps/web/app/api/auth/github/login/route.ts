import { generateState } from 'arctic';
import { NextRequest, NextResponse } from 'next/server';
import { safeNext } from '@openself/core/auth-policy';
import { getRuntime } from '../../../../../lib/runtime';
import { githubOAuth } from '../../../../../lib/github-auth';
import { apiError, cookieOptions } from '../../../../../lib/api';
import { eq, schema } from '@openself/db';
export async function GET(request: NextRequest) {
  try {
    const { env, db, sessions } = getRuntime();
    const session = await sessions.validate(request.cookies.get(env.SESSION_COOKIE_NAME)?.value);
    const [user] = session
      ? await db.select().from(schema.users).where(eq(schema.users.id, session.userId))
      : [];
    const privateAccess =
      request.nextUrl.searchParams.get('private') === '1' || user?.privateRepoEnabled === true;
    const state = generateState();
    const next = safeNext(request.nextUrl.searchParams.get('next'));
    const url = githubOAuth(env).createAuthorizationURL(state, [
      'read:user',
      'user:email',
      'public_repo',
      ...(privateAccess ? ['repo'] : []),
    ]);
    const response = NextResponse.redirect(url);
    const options = { ...cookieOptions(new URL(env.APP_URL).protocol === 'https:'), maxAge: 600 };
    response.cookies.set('os_oauth_state', state, options);
    response.cookies.set('os_oauth_next', next, options);
    response.cookies.set('os_oauth_private', privateAccess ? '1' : '0', options);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch {
    return apiError('configuration_unavailable', 503);
  }
}
