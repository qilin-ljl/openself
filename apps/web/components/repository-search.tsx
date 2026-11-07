'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search, Star, ArrowUpRight } from 'lucide-react';
import type { GitHubClient } from '@openself/github';
import { Link } from '../i18n/navigation';
import { ErrorNotice, Loading, Pager, useResource } from './data';
type Results = Awaited<ReturnType<GitHubClient['searchRepos']>>;
export function RepositorySearch() {
  const t = useTranslations('workspace');
  const [input, setInput] = useState(''),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(input.trim().replace(/^https:\/\/github.com\//, ''));
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [input]);
  const resource = useResource<Results>(
    query ? '/api/repos/search?q=' + encodeURIComponent(query) + '&page=' + page : null,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t('searchTitle')}</h1>
          <p>{t('searchDescription')}</p>
        </div>
      </div>
      <label className="search-field">
        <Search size={21} />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('search')}
          autoFocus
        />
      </label>
      <ErrorNotice code={resource.error} retry={resource.reload} />
      {resource.loading && <Loading />}
      <div className="repo-results">
        {resource.data?.items.map((repo) => (
          <Link href={'/r/' + repo.full_name} key={repo.id} className="repo-result">
            <div>
              <h2>{repo.full_name}</h2>
              <p>{repo.description ?? t('noDescription')}</p>
              <div className="repo-meta">
                <span>
                  <Star size={14} />
                  {repo.stargazers_count.toLocaleString()}
                </span>
                {repo.language && <span>{repo.language}</span>}
                <span>{t('updated', { date: repo.updated_at?.slice(0, 10) ?? '' })}</span>
              </div>
            </div>
            <ArrowUpRight size={21} />
          </Link>
        ))}
      </div>
      {resource.data && !resource.data.items.length && (
        <p className="empty-state">{t('noResults')}</p>
      )}
      {resource.data && (
        <Pager page={page} more={resource.data.total_count > page * 20} onChange={setPage} />
      )}
    </>
  );
}
