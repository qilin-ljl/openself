import { NextRequest } from 'next/server';
import { createExtensionAuth, extensionRequestOrigin } from '@openself/core/extension-auth';
import { z } from '@openself/shared/api';
import { getRuntime } from '../../../../lib/runtime';
import { body, respond, preflight } from '../../../../lib/request';
export function POST(request: NextRequest) {
  return respond(async () => {
    const input = z
      .object({ code: z.string().regex(/^[A-Za-z0-9_-]{43}$/), redirectUri: z.url() })
      .parse(await body(request));
    const { db, env } = getRuntime();
    return createExtensionAuth(db, env.EXTENSION_IDS).exchange(
      input.code,
      input.redirectUri,
      extensionRequestOrigin(
        request.headers.get('origin'),
        request.headers.get('x-openself-extension'),
        env.EXTENSION_IDS,
      ),
    );
  }, request);
}
export { preflight as OPTIONS };
