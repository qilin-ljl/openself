import { getTranslations } from 'next-intl/server';
import { IssueEditor } from '../../../../../../../../components/issue-editor';
export default async function Page({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
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
      <IssueEditor repoFullName={owner + '/' + repo} />
    </>
  );
}
