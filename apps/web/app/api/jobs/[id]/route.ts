import type { NextRequest } from 'next/server';
import { z } from '@openself/shared/api';
import { authenticated, respond, preflight } from '../../../../lib/request';
import { getAI } from '../../../../lib/ai';
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const user = await authenticated(request),
      { id } = await params;
    return getAI().getJob(user.id, z.uuid().parse(id));
  }, request);
}
export { preflight as OPTIONS };
