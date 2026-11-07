import { getTranslations } from 'next-intl/server';
import { IssueEditor } from '../../../../../../../../components/issue-editor';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ scan?: string; finding?: string; job?: string }>;
}) {
  const { owner, repo } = await params;
  const query = await searchParams;
  const t = await getTranslations('workspace');
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{owner + '/' + repo}</div>
          <h1>{t('draftTitle')}</h1>
          <p>{t('draftDescription')}</p>
        </div>
      </div>
      <IssueEditor
        assistantJobId={typeof query.job === 'string' ? query.job : undefined}
        repoFullName={owner + '/' + repo}
        scanJobId={typeof query.scan === 'string' ? query.scan : undefined}
        findingId={typeof query.finding === 'string' ? query.finding : undefined}
      />
    </>
  );
}
