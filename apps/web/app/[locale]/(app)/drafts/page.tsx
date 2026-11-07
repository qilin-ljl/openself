import { DraftQueue } from '../../../../components/draft-queue';
export default async function Page({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind } = await searchParams;
  const selected =
    kind === 'pull_request' || kind === 'review' ? kind : kind === 'all' ? '' : 'issue';
  return <DraftQueue key={selected} initialKind={selected} />;
}
