import { NextRequest, NextResponse } from 'next/server';
import { createExtensionAuth, validateExtensionRedirect } from '@openself/core/extension-auth';
import { z } from '@openself/shared/api';
import { AppError } from '@openself/shared/errors';
import { getRuntime } from '../../../../lib/runtime';
import { currentUser } from '../../../../lib/session';
import { apiError } from '../../../../lib/api';
export async function GET(request: NextRequest) {
  try {
    const { env, db } = getRuntime();
    const redirect = validateExtensionRedirect(
        request.nextUrl.searchParams.get('redirect_uri') ?? '',
        env.EXTENSION_IDS,
      ),
      state = z.string().min(10).max(200).parse(request.nextUrl.searchParams.get('state'));
    const user = await currentUser();
    if (!user) {
      const next =
        '/zh/extension/connect?redirect_uri=' +
        encodeURIComponent(redirect) +
        '&state=' +
        encodeURIComponent(state);
      return NextResponse.redirect(
        new URL('/api/auth/github/login?next=' + encodeURIComponent(next), env.APP_URL),
      );
    }
    const code = await createExtensionAuth(db, env.EXTENSION_IDS).issue(user.id, redirect);
    const url = new URL(redirect);
    url.searchParams.set('code', code);
    url.searchParams.set('state', state);
    const response = NextResponse.redirect(url);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    return apiError(
      error instanceof AppError ? error.code : 'validation',
      error instanceof AppError ? error.status : 400,
    );
  }
}
