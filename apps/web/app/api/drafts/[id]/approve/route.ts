import type { NextRequest } from 'next/server';
import { z } from '@openself/shared/api';
import { draftDTO } from '@openself/core/drafts';
import { authenticated, respond, preflight } from '../../../../../lib/request';
import { getWorkspace } from '../../../../../lib/workspace';
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const user = await authenticated(request),
      { id } = await params;
    return draftDTO(await getWorkspace().drafts.approve(user.id, z.uuid().parse(id)));
  }, request);
}
export { preflight as OPTIONS };
