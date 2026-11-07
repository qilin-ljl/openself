import { NextResponse, type NextRequest } from 'next/server';
import { getTestContext, testAuthEnabled } from '../../../../lib/test-context';
export async function POST(request?: NextRequest) {
  if (!testAuthEnabled()) return new NextResponse(null, { status: 404 });
  const context = getTestContext();
  if (!context) return new NextResponse(null, { status: 503 });
  const input = request
    ? ((await request.json().catch(() => null)) as { account?: string } | null)
    : null;
  const userId = input?.account === 'contributions' ? context.contributionUserId : context.userId;
  if (!userId) return new NextResponse(null, { status: 503 });
  const session = await context.sessions.create(userId);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(context.env.SESSION_COOKIE_NAME, session.id, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    expires: session.expiresAt,
  });
  return response;
}
