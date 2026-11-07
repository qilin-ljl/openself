import { type Database, eq, schema } from '@openself/db';
import { randomBytes } from 'node:crypto';
import { AppError } from '@openself/shared/errors';
function ids(value: string) {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => /^[a-p]{32}$/.test(v));
}
export function extensionOrigin(origin: string | null, allowed: string): boolean {
  return origin !== null && ids(allowed).some((id) => origin === 'chrome-extension://' + id);
}
export function extensionRequestOrigin(
  origin: string | null,
  extensionId: string | null,
  allowed: string,
): string | null {
  if (origin !== null) return origin;
  return extensionId && ids(allowed).includes(extensionId)
    ? 'chrome-extension://' + extensionId
    : null;
}
export function validateExtensionRedirect(value: string, allowed: string): string {
  if (!ids(allowed).some((id) => value === 'https://' + id + '.chromiumapp.org/'))
    throw new AppError('extension_not_allowed', 403);
  return value;
}
export function createExtensionAuth(db: Database, allowed: string) {
  return {
    async issue(userId: string, redirect: string) {
      validateExtensionRedirect(redirect, allowed);
      const code = randomBytes(32).toString('base64url');
      await db
        .insert(schema.extensionAuthCodes)
        .values({
          code,
          userId,
          redirectUri: redirect,
          expiresAt: new Date(Date.now() + 5 * 60000),
        });
      return code;
    },
    async exchange(
      code: string,
      redirect: string,
      origin: string | null,
    ): Promise<{ token: string; expiresAt: string }> {
      validateExtensionRedirect(redirect, allowed);
      const expected = 'chrome-extension://' + new URL(redirect).hostname.split('.')[0];
      if (origin !== expected || !extensionOrigin(origin, allowed))
        throw new AppError('invalid_origin', 403);
      return db.transaction(async (tx) => {
        const [record] = await tx
          .select()
          .from(schema.extensionAuthCodes)
          .where(eq(schema.extensionAuthCodes.code, code))
          .for('update');
        if (
          !record ||
          record.usedAt ||
          record.expiresAt <= new Date() ||
          record.redirectUri !== redirect
        )
          throw new AppError('invalid_auth_code', 400);
        const token = randomBytes(32).toString('base64url'),
          expiresAt = new Date(Date.now() + 30 * 86400000);
        await tx
          .update(schema.extensionAuthCodes)
          .set({ usedAt: new Date() })
          .where(eq(schema.extensionAuthCodes.code, code));
        await tx
          .insert(schema.sessions)
          .values({
            id: token,
            userId: record.userId,
            kind: 'extension',
            expiresAt,
            lastSeenAt: new Date(),
          });
        return { token, expiresAt: expiresAt.toISOString() };
      });
    },
  };
}
