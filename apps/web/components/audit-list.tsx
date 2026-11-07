'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowUpRight } from 'lucide-react';
import { useResource, ErrorNotice, Loading, Pager } from './data';
type Entry = {
  id: string;
  repoFullName: string;
  action: string;
  target: string;
  githubUrl: string;
  createdAt: string;
};
export function AuditList() {
  const t = useTranslations('workspace'),
    [page, setPage] = useState(1);
  const r = useResource<{ items: Entry[] }>('/api/audit?page=' + page);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t('auditTitle')}</h1>
          <p>{t('auditDescription')}</p>
        </div>
      </div>
      <ErrorNotice code={r.error} retry={r.reload} />
      {r.loading && <Loading />}
      <div className="discussion-list">
        {r.data?.items.map((item) => (
          <a
            className="discussion-row"
            key={item.id}
            href={item.githubUrl}
            target="_blank"
            rel="noreferrer"
          >
            <div>
              <strong>{item.repoFullName + ' #' + item.target}</strong>
              <p>
                {t(item.action === 'issue.create' ? 'issueKind' : 'reviewKind') +
                  ' · ' +
                  new Date(item.createdAt).toLocaleString()}
              </p>
            </div>
            <ArrowUpRight size={18} />
          </a>
        ))}
        {r.data && !r.data.items.length && <p className="empty-state">{t('emptyAudit')}</p>}
      </div>
      <Pager page={page} more={r.data?.items.length === 20} onChange={setPage} />
    </>
  );
}
