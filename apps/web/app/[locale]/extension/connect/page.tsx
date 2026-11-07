import { redirect } from 'next/navigation';
export default async function Connect({
  searchParams,
}: {
  searchParams: Promise<{ redirect_uri?: string; state?: string }>;
}) {
  const q = await searchParams;
  redirect(
    '/api/extension/authorize?redirect_uri=' +
      encodeURIComponent(q.redirect_uri ?? '') +
      '&state=' +
      encodeURIComponent(q.state ?? ''),
  );
}
