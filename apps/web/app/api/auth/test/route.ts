import { NextResponse } from 'next/server';
import { getTestContext, testAuthEnabled } from '../../../../lib/test-context';
export async function POST() {
  if (!testAuthEnabled()) return new NextResponse(null, { status: 404 });
  const context = getTestContext();
  if (!context) return new NextResponse(null, { status: 503 });
  const session = await context.sessions.create(context.userId);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(context.env.SESSION_COOKIE_NAME, session.id, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    expires: session.expiresAt,
  });
  return response;
}
