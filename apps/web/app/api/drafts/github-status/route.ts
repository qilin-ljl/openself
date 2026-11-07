import type { NextRequest } from 'next/server';
import { z } from '@openself/shared/api';
import { readDraftGitHubStatuses } from '@openself/core/draft-github-status';
import { authenticated, respond, preflight } from '../../../../lib/request';
import { getRuntime } from '../../../../lib/runtime';
import { getWorkspace } from '../../../../lib/workspace';
export async function GET(request: NextRequest) {
  return respond(async () => {
    const user = await authenticated(request);
    const ids = z
      .array(z.uuid())
      .min(1)
      .max(20)
      .parse(request.nextUrl.searchParams.get('ids')?.split(',') ?? []);
    return readDraftGitHubStatuses(getRuntime().db, getWorkspace(), user, [...new Set(ids)]);
  }, request);
}
export { preflight as OPTIONS };
