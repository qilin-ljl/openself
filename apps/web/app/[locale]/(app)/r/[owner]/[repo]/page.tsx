import { RepositoryView } from '../../../../../../components/repository-view';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { owner, repo } = await params;
  const { tab } = await searchParams;
  const initialTab = tab === 'pulls' || tab === 'issues' ? tab : 'overview';
  return <RepositoryView key={initialTab} owner={owner} repo={repo} initialTab={initialTab} />;
}
