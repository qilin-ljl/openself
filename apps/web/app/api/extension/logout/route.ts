import { NextRequest } from 'next/server';
import { authenticated, respond, preflight } from '../../../../lib/request';
import { getRuntime } from '../../../../lib/runtime';
import { AppError } from '@openself/shared/errors';
export function POST(request: NextRequest) {
  return respond(async () => {
    await authenticated(request);
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(
      request.headers.get('authorization') ?? '',
    )?.[1];
    if (!token) throw new AppError('unauthorized', 401);
    await getRuntime().sessions.revoke(token);
    return { ok: true };
  }, request);
}
export { preflight as OPTIONS };
