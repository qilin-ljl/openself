import { RepositoryScan } from '../../../../../../../components/repository-scan';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ job?: string; discovery?: string }>;
}) {
  const { owner, repo } = await params,
    query = await searchParams;
  return (
    <RepositoryScan
      key={owner + '/' + repo}
      repo={owner + '/' + repo}
      initialJobId={typeof query.job === 'string' ? query.job : undefined}
      discoveryId={typeof query.discovery === 'string' ? query.discovery : undefined}
    />
  );
}
