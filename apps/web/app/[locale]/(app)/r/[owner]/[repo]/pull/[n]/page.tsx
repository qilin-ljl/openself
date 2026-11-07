import { ReviewWorkbench } from '../../../../../../../../components/review-workbench';
import { notFound } from 'next/navigation';
export default async function Page({
  params,
}: {
  params: Promise<{ owner: string; repo: string; n: string }>;
}) {
  const { owner, repo, n } = await params;
  if (!/^[1-9]\d*$/.test(n)) notFound();
  return <ReviewWorkbench owner={owner} repo={repo} n={Number(n)} />;
}
