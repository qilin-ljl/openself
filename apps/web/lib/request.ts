import { NextRequest, NextResponse } from 'next/server';
import { eq, schema } from '@openself/db';
import { AppError, isAppError } from '@openself/shared/errors';
import { z } from '@openself/shared/api';
import { validOrigin } from '@openself/core/auth-policy';
import type { User } from '@openself/core/drafts';
import { getRuntime } from './runtime';
import { apiError } from './api';
import { extensionOrigin, extensionRequestOrigin } from '@openself/core/extension-auth';
export async function authenticated(request: NextRequest): Promise<User> {
  const cookie = request.cookies.get(process.env.SESSION_COOKIE_NAME || 'os_session')?.value;
  const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(
    request.headers.get('authorization') ?? '',
  )?.[1];
  if (!cookie && !bearer) throw new AppError('unauthorized', 401);
  const { env, db, sessions } = getRuntime();
  if (
    !cookie &&
    !extensionOrigin(
      extensionRequestOrigin(
        request.headers.get('origin'),
        request.headers.get('x-openself-extension'),
        env.EXTENSION_IDS,
      ),
      env.EXTENSION_IDS,
    )
  )
    throw new AppError('invalid_origin', 403);
  if (
    !!cookie &&
    !['GET', 'HEAD'].includes(request.method) &&
    !validOrigin(request.headers.get('origin'), env.APP_URL)
  )
    throw new AppError('invalid_origin', 403);
  const session = await sessions.validate(cookie ?? bearer, cookie ? 'web' : 'extension');
  if (!session) throw new AppError('unauthorized', 401);
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user) throw new AppError('unauthorized', 401);
  return user;
}
export async function body(request: NextRequest) {
  if (Number(request.headers.get('content-length') ?? 0) > 250000)
    throw new AppError('payload_too_large', 413);
  const text = await request.text();
  if (text.length > 250000) throw new AppError('payload_too_large', 413);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError('validation', 400);
  }
}
export function cors(response: NextResponse, request?: NextRequest) {
  if (request) {
    try {
      const origin = request.headers.get('origin');
      if (extensionOrigin(origin, getRuntime().env.EXTENSION_IDS)) {
        response.headers.set('Access-Control-Allow-Origin', origin!);
        response.headers.set('Vary', 'Origin');
        response.headers.set(
          'Access-Control-Allow-Headers',
          'Authorization, Content-Type, X-OpenSelf-Extension',
        );
        response.headers.set(
          'Access-Control-Allow-Methods',
          'GET, POST, PATCH, PUT, DELETE, OPTIONS',
        );
      }
    } catch {
      /* Invalid configuration does not grant CORS. */
    }
  }
  return response;
}
export function preflight(request: NextRequest) {
  try {
    if (!extensionOrigin(request.headers.get('origin'), getRuntime().env.EXTENSION_IDS))
      return apiError('invalid_origin', 403);
    return cors(new NextResponse(null, { status: 204 }), request);
  } catch {
    return apiError('service_unavailable', 503);
  }
}
export async function respond(action: () => Promise<unknown>, request?: NextRequest) {
  try {
    return cors(
      NextResponse.json(await action(), { headers: { 'Cache-Control': 'no-store' } }),
      request,
    );
  } catch (error) {
    if (isAppError(error)) return cors(apiError(error.code, error.status), request);
    if (error instanceof z.ZodError) return cors(apiError('validation', 400), request);
    return cors(apiError('service_unavailable', 503), request);
  }
}
