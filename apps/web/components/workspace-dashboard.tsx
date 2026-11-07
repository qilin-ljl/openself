'use client';
import { useTranslations } from 'next-intl';
import { GitPullRequest, FileText, ArrowRight } from 'lucide-react';
import { Button } from '@openself/ui/button';
import type { GitHubClient } from '@openself/github';
import { Link } from '../i18n/navigation';
import { ErrorNotice, Loading, useResource } from './data';
import { Radar } from './radar';
import { OwnedRepositories } from './owned-repositories';
import { TaskHistory } from './task-history';
type Item = Awaited<ReturnType<GitHubClient['searchIssues']>>['items'][number];
export function WorkspaceDashboard({ login }: { login: string }) {
  const t = useTranslations('workspace');
  const r = useResource<{ requested: Item[]; mine: Item[]; draftCount: number }>('/api/dashboard');
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{login}</div>
          <h1>{t('dashboardTitle')}</h1>
          <p>{t('dashboardDescription')}</p>
        </div>
        <Button asChild>
          <Link href="/search">
            {t('navSearch')}
            <ArrowRight size={16} />
          </Link>
        </Button>
      </div>
      <OwnedRepositories />
      <TaskHistory compact />
      <ErrorNotice code={r.error} retry={r.reload} />
      {r.loading && <Loading />}
      {r.data && (
        <>
          <div className="dashboard-columns">
            {(['requested', 'mine'] as const).map((key) => (
              <section className="dashboard-section" key={key}>
                <h2>
                  <GitPullRequest size={18} />
                  {t(key)}
                </h2>
                {r.data![key].slice(0, 8).map((item) => (
                  <Link
                    className="dashboard-item"
                    key={item.id}
                    href={
                      '/r/' +
                      new URL(item.html_url).pathname.split('/').slice(1, 3).join('/') +
                      '/pull/' +
                      item.number
                    }
                  >
                    <strong>{item.title}</strong>
                    <span>{'#' + item.number + ' · ' + item.user?.login}</span>
                  </Link>
                ))}
                {!r.data![key].length && <p className="empty-state">{t('noPulls')}</p>}
              </section>
            ))}
          </div>
          <div className="account-panel">
            <div className="panel-heading">
              <FileText size={20} />
              {t('draftCount', { count: r.data.draftCount })}
            </div>
            <Button asChild variant="outline">
              <Link href="/drafts">{t('viewDrafts')}</Link>
            </Button>
          </div>
          <Radar />
        </>
      )}
    </>
  );
}
