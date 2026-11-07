import type { NextRequest } from 'next/server';
import { authenticated, body, respond, preflight } from '../../../lib/request';
import { getAI } from '../../../lib/ai';
export async function POST(request: NextRequest) {
  return respond(async () => {
    const user = await authenticated(request);
    return getAI().plan(user, await body(request));
  }, request);
}
export { preflight as OPTIONS };
