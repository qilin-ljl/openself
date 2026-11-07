import { RepositoryScan } from '../../../../../../../components/repository-scan';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ job?: string; plan?: string; discovery?: string }>;
}) {
  const { owner, repo } = await params,
    query = await searchParams;
  return (
    <RepositoryScan
      key={owner + '/' + repo}
      repo={owner + '/' + repo}
      initialJobId={typeof query.job === 'string' ? query.job : undefined}
      initialPlanId={typeof query.plan === 'string' ? query.plan : undefined}
      discoveryId={typeof query.discovery === 'string' ? query.discovery : undefined}
    />
  );
}
