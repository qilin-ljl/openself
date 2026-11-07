import { ContributionDiscovery } from '../../../../components/contribution-discovery';
export default async function Page({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const query = await searchParams;
  return (
    <ContributionDiscovery initialJobId={typeof query.job === 'string' ? query.job : undefined} />
  );
}
