import type { NextRequest } from 'next/server';
import { DraftListInput } from '@openself/shared/api';
import { draftDTO } from '@openself/core/drafts';
import { authenticated, body, respond, preflight } from '../../../lib/request';
import { getWorkspace } from '../../../lib/workspace';
export async function GET(request: NextRequest) {
  return respond(async () => {
    const user = await authenticated(request),
      query = request.nextUrl.searchParams;
    const input = DraftListInput.parse({
      kind: query.get('kind') || undefined,
      status: query.get('status') || undefined,
      q: query.get('q') ?? '',
      page: query.get('page') ?? undefined,
    });
    const result = await getWorkspace().drafts.search(user.id, input);
    return { ...result, items: result.items.map(draftDTO) };
  }, request);
}
export async function POST(request: NextRequest) {
  return respond(async () => {
    const user = await authenticated(request);
    return draftDTO(await getWorkspace().drafts.create(user, await body(request)));
  }, request);
}
export { preflight as OPTIONS };
