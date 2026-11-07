'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowUpRight, GitPullRequest, MessageSquare, Star } from 'lucide-react';
import { Button } from '@openself/ui/button';
import type { GitHubClient } from '@openself/github';
import { Link } from '../i18n/navigation';
import { ErrorNotice, Loading, Pager, useResource } from './data';
import { Markdown } from './markdown';
type Detail = {
  repository: Awaited<ReturnType<GitHubClient['getRepo']>>;
  readme: { body: string; path: string };
  contributing: { body: string; path: string };
};
export function RepositoryView({
  owner,
  repo,
  initialTab = 'overview',
}: {
  owner: string;
  repo: string;
  initialTab?: 'overview' | 'issues' | 'pulls';
}) {
  const t = useTranslations('workspace');
  const [tab, setTab] = useState(initialTab),
    [state, setState] = useState('open'),
    [page, setPage] = useState(1);
  const prefix = '/api/repos/' + owner + '/' + repo;
  const detail = useResource<Detail>(prefix);
  const list = useResource<Awaited<ReturnType<GitHubClient['listIssues']>>>(
    tab === 'overview' ? null : prefix + '/' + tab + '?state=' + state + '&page=' + page,
  );
  const r = detail.data?.repository;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{owner}</div>
          <h1>{repo}</h1>
          <p>{r?.description}</p>
          {r && (
            <div className="repo-meta">
              <span>
                <Star size={14} />
                {r.stargazers_count.toLocaleString()}
              </span>
              <span>{r.language}</span>
            </div>
          )}
        </div>
        <div className="inline-actions">
          <Button variant="outline" asChild>
            <Link href={'/r/' + owner + '/' + repo + '/scan'}>{t('scanRepository')}</Link>
          </Button>
          <Button variant="outline" asChild>
            <a href={'https://github.com/' + owner + '/' + repo} target="_blank" rel="noreferrer">
              {t('openGithub')}
              <ArrowUpRight size={16} />
            </a>
          </Button>
          {r && !r.archived && r.has_issues && (
            <Button asChild>
              <Link href={'/r/' + owner + '/' + repo + '/issues/new'}>{t('newIssue')}</Link>
            </Button>
          )}
        </div>
      </div>
      <div className="tabs" role="tablist">
        {(['overview', 'issues', 'pulls'] as const).map((value) => (
          <button
            role="tab"
            aria-selected={tab === value}
            key={value}
            onClick={() => {
              setTab(value);
              setPage(1);
            }}
          >
            {t(value)}
          </button>
        ))}
      </div>
      <ErrorNotice
        code={detail.error ?? list.error}
        retry={() => {
          detail.reload();
          list.reload();
        }}
      />
      {detail.loading && <Loading />}
      {tab === 'overview' && detail.data ? (
        <div className="repo-documents">
          <section>
            <h2>{t('readme')}</h2>
            <Markdown
              body={detail.data.readme.body || t('noDocument')}
              base={
                'https://github.com/' +
                owner +
                '/' +
                repo +
                '/blob/' +
                r?.default_branch +
                '/' +
                detail.data.readme.path
              }
            />
          </section>
          <section>
            <h2>{t('contributing')}</h2>
            <Markdown
              body={detail.data.contributing.body || t('noDocument')}
              base={
                'https://github.com/' +
                owner +
                '/' +
                repo +
                '/blob/' +
                r?.default_branch +
                '/' +
                detail.data.contributing.path
              }
            />
          </section>
        </div>
      ) : (
        tab !== 'overview' && (
          <>
            <div className="filter-row">
              {['open', 'closed'].map((v) => (
                <button
                  key={v}
                  className={state === v ? 'selected' : ''}
                  onClick={() => {
                    setState(v);
                    setPage(1);
                  }}
                >
                  {t(v)}
                </button>
              ))}
            </div>
            {list.loading ? (
              <Loading />
            ) : (
              <div className="discussion-list">
                {list.data?.items.map((item) => (
                  <div key={item.number} className="discussion-row">
                    {tab === 'pulls' ? <GitPullRequest size={18} /> : <MessageSquare size={18} />}
                    <div>
                      {tab === 'pulls' ? (
                        <Link href={'/r/' + owner + '/' + repo + '/pull/' + item.number}>
                          {item.title}
                        </Link>
                      ) : (
                        <a href={item.html_url} target="_blank" rel="noreferrer">
                          {item.title}
                        </a>
                      )}
                      <p>
                        {'#' +
                          item.number +
                          ' · ' +
                          item.user?.login +
                          ' · ' +
                          item.created_at?.slice(0, 10)}
                      </p>
                    </div>
                  </div>
                ))}
                {list.data && !list.data.items.length && (
                  <p className="empty-state">{t('noItems')}</p>
                )}
              </div>
            )}
            <Pager page={page} more={list.data?.hasMore ?? false} onChange={setPage} />
          </>
        )
      )}
    </>
  );
}
