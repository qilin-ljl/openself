import { Viewer } from '@openself/shared/api';
import { UpdatePreferences } from '@openself/shared/api';
import { NextRequest } from 'next/server';
import { authenticated, body, respond, preflight } from '../../../lib/request';
import { getRuntime } from '../../../lib/runtime';
import { eq, schema } from '@openself/db';
import { AppError } from '@openself/shared/errors';
export async function PATCH(request: NextRequest) {
  return respond(async () => {
    const user = await authenticated(request);
    const input = UpdatePreferences.parse(await body(request));
    if (input.privateRepoEnabled) {
      const [token] = await getRuntime()
        .db.select()
        .from(schema.oauthTokens)
        .where(eq(schema.oauthTokens.userId, user.id));
      if (!token?.scopes.split(/[ ,]+/).includes('repo'))
        throw new AppError('reauthorization_required', 403);
    }
    if (input.privateAiConsent && !(input.privateRepoEnabled ?? user.privateRepoEnabled))
      throw new AppError('private_repo_disabled', 403);
    const { privateAiConsent, ...preferences } = input;
    const [saved] = await getRuntime()
      .db.update(schema.users)
      .set({
        ...preferences,
        ...(privateAiConsent !== undefined
          ? { privateAiConsentAt: privateAiConsent ? new Date() : null }
          : {}),
        ...(input.privateRepoEnabled === false ? { privateAiConsentAt: null } : {}),
      })
      .where(eq(schema.users.id, user.id))
      .returning();
    return Viewer.parse({ ...saved, privateAiConsent: !!saved?.privateAiConsentAt });
  }, request);
}
export async function GET(request: NextRequest) {
  return respond(async () => {
    const user = await authenticated(request);
    return Viewer.parse({ ...user, privateAiConsent: !!user.privateAiConsentAt });
  }, request);
}
export { preflight as OPTIONS };
