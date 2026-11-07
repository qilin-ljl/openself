'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, GitBranch, RefreshCw } from 'lucide-react';
import { Button } from '@openself/ui/button';
import type { OwnedRepositoryDTO } from '@openself/shared/api';
import { Link } from '../i18n/navigation';
import { ErrorNotice, Loading, useResource } from './data';

export function OwnedRepositories() {
  const t = useTranslations('workspace');
  const r = useResource<{ items: OwnedRepositoryDTO[] }>('/api/me/repos');
  const [visible, setVisible] = useState(6);
  return (
    <section
      className="dashboard-section owned-repositories"
      aria-labelledby="owned-repositories-title"
    >
      <div className="owned-repositories-header">
        <div>
          <h2 id="owned-repositories-title">{t('ownedRepositories')}</h2>
          <p>{t('ownedRepositoriesDescription')}</p>
        </div>
        <Button variant="outline" disabled={r.loading} onClick={r.reload}>
          <RefreshCw size={15} />
          {t('refreshRepositories')}
        </Button>
      </div>
      <ErrorNotice code={r.error} retry={r.reload} />
      {r.loading && <Loading />}
      {r.data && !r.data.items.length && (
        <div className="empty-state">
          <p>{t('ownedRepositoriesEmpty')}</p>
          <Link className="text-link" href="/settings">
            {t('repositoryAccessSettings')}
          </Link>
        </div>
      )}
      <div className="owned-repository-grid">
        {r.data?.items.slice(0, visible).map((repo) => (
          <Link
            className="owned-repository-card"
            key={repo.id}
            href={'/r/' + repo.fullName + '?tab=pulls'}
          >
            <div className="owned-repository-name">
              <GitBranch size={18} />
              <h3>{repo.fullName}</h3>
            </div>
            <p className="owned-repository-description">{repo.description || t('noDescription')}</p>
            <div className="owned-repository-footer">
              <div className="owned-repository-meta">
                {repo.language && <span>{repo.language}</span>}
                {repo.private && <span>{t('privateRepository')}</span>}
                {repo.archived && <span>{t('archivedRepository')}</span>}
              </div>
              <span className="owned-repository-action">
                {t('viewRepositoryPulls')}
                <ArrowRight size={15} />
              </span>
            </div>
          </Link>
        ))}
      </div>
      {r.data && visible < r.data.items.length && (
        <Button variant="ghost" onClick={() => setVisible((value) => value + 6)}>
          {t('moreRepositories')}
        </Button>
      )}
    </section>
  );
}
