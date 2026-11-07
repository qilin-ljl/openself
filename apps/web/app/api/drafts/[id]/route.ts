import type { NextRequest } from 'next/server';
import { z } from '@openself/shared/api';
import { draftDTO } from '@openself/core/drafts';
import { authenticated, body, respond, preflight } from '../../../../lib/request';
import { getWorkspace } from '../../../../lib/workspace';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, { params }: Context) {
  return respond(async () => {
    const user = await authenticated(request),
      { id } = await params;
    return draftDTO(await getWorkspace().drafts.find(user.id, z.uuid().parse(id)));
  }, request);
}
export async function PATCH(request: NextRequest, { params }: Context) {
  return respond(async () => {
    const user = await authenticated(request),
      { id } = await params;
    return draftDTO(
      await getWorkspace().drafts.update(user, z.uuid().parse(id), await body(request)),
    );
  }, request);
}
export async function DELETE(request: NextRequest, { params }: Context) {
  return respond(async () => {
    const user = await authenticated(request),
      { id } = await params;
    return draftDTO(await getWorkspace().drafts.discard(user.id, z.uuid().parse(id)));
  }, request);
}
export { preflight as OPTIONS };
