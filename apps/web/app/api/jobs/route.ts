import type { NextRequest } from 'next/server';
import { PageNumber } from '@openself/shared/api';
import { authenticated, respond, preflight } from '../../../lib/request';
import { getAI } from '../../../lib/ai';
export async function GET(request: NextRequest) {
  return respond(async () => {
    const user = await authenticated(request);
    return getAI().listJobs(
      user.id,
      PageNumber.parse(request.nextUrl.searchParams.get('page') ?? undefined),
    );
  }, request);
}
export { preflight as OPTIONS };
