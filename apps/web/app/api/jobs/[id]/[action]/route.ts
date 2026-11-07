import type { NextRequest } from 'next/server';
import { z } from '@openself/shared/api';
import { AppError } from '@openself/shared/errors';
import { authenticated, respond, preflight } from '../../../../../lib/request';
import { getAI } from '../../../../../lib/ai';
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  return respond(async () => {
    const user = await authenticated(request),
      { id, action } = await params,
      jobId = z.uuid().parse(id);
    if (action === 'cancel') return getAI().cancelJob(user.id, jobId);
    if (action === 'retry') return getAI().retryJob(user, jobId);
    throw new AppError('not_found', 404);
  }, request);
}
export { preflight as OPTIONS };
