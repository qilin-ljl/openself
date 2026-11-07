import { NextRequest, NextResponse } from 'next/server';
import { validOrigin } from '@openself/core/auth-policy';
import { getRuntime } from '../../../../lib/runtime';
import { apiError } from '../../../../lib/api';
export async function POST(request: NextRequest) {
  try {
    const { env, sessions } = getRuntime();
    if (!validOrigin(request.headers.get('origin'), env.APP_URL))
      return apiError('invalid_origin', 403);
    const token = request.cookies.get(env.SESSION_COOKIE_NAME)?.value;
    if (token) await sessions.revoke(token);
    const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.delete(env.SESSION_COOKIE_NAME);
    return response;
  } catch {
    return apiError('service_unavailable', 503);
  }
}
