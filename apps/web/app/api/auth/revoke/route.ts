import { NextRequest, NextResponse } from 'next/server';
import { validOrigin } from '@openself/core/auth-policy';
import { decrypt } from '@openself/core/crypto';
import { eq, schema } from '@openself/db';
import { getRuntime } from '../../../../lib/runtime';
import { apiError } from '../../../../lib/api';
export async function POST(request: NextRequest) {
  try {
    const { env, db, sessions } = getRuntime();
    if (!validOrigin(request.headers.get('origin'), env.APP_URL))
      return apiError('invalid_origin', 403);
    const session = await sessions.validate(request.cookies.get(env.SESSION_COOKIE_NAME)?.value);
    if (!session) return apiError('unauthorized', 401);
    const [token] = await db
      .select()
      .from(schema.oauthTokens)
      .where(eq(schema.oauthTokens.userId, session.userId));
    if (token) {
      const result = await fetch(
        `https://api.github.com/applications/${encodeURIComponent(env.GITHUB_CLIENT_ID)}/grant`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Basic ${Buffer.from(`${env.GITHUB_CLIENT_ID}:${env.GITHUB_CLIENT_SECRET}`).toString('base64')}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'User-Agent': 'OpenSelf/0.0.1',
          },
          body: JSON.stringify({ access_token: decrypt(token.accessTokenEnc, env.ENCRYPTION_KEY) }),
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!result.ok && result.status !== 404) return apiError('github_revoke_failed', 502);
    }
    await db.transaction(async (tx) => {
      await tx.delete(schema.oauthTokens).where(eq(schema.oauthTokens.userId, session.userId));
      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, session.userId));
      await tx.delete(schema.userApiKeys).where(eq(schema.userApiKeys.userId, session.userId));
      await tx
        .delete(schema.extensionAuthCodes)
        .where(eq(schema.extensionAuthCodes.userId, session.userId));
    });
    const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.delete(env.SESSION_COOKIE_NAME);
    return response;
  } catch {
    return apiError('service_unavailable', 503);
  }
}
