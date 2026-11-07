'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, GitBranch, Search } from 'lucide-react';
import { Button } from '@openself/ui/button';
import type { DiscoveryResult } from '@openself/shared/contributions';
import { parseGitHubUrl } from '@openself/shared/github-url';
import { Link, useRouter } from '../i18n/navigation';
import { api, ErrorNotice, RequestError } from './data';
import { useAIJob } from './use-ai-job';
import { JobProgress } from './job-progress';

export function ContributionDiscovery({ initialJobId }: { initialJobId?: string }) {
  const t = useTranslations('contribute'),
    router = useRouter();
  const [idea, setIdea] = useState(''),
    [repository, setRepository] = useState('');
  const [job, setJob] = useState(initialJobId),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const task = useAIJob(job);
  const result =
    task.data?.kind === 'discovery.find' && task.data.status === 'done'
      ? (task.data.resultJson as DiscoveryResult)
      : undefined;
  const pending =
    busy || (!!job && (!task.data || ['queued', 'running'].includes(task.data.status)));
  useEffect(() => setJob(initialJobId), [initialJobId]);
  useEffect(() => {
    if (result) setIdea((value) => value || result.idea);
  }, [result]);
  async function discover() {
    setBusy(true);
    setError(undefined);
    try {
      const response = await api<{ jobId: string }>('/api/discover-projects', {
        method: 'POST',
        body: JSON.stringify({ idea }),
      });
      setJob(response.jobId);
      router.replace('/contribute?job=' + response.jobId);
    } catch (e) {
      setError(e instanceof RequestError ? e.code : 'unknown');
    } finally {
      setBusy(false);
    }
  }
  function openRepository() {
    const value = repository.trim().replace(/\.git\/?$/, '');
    const target = parseGitHubUrl(
      value.startsWith('https://') ? value : 'https://github.com/' + value,
    );
    if (!target) {
      setError('validation');
      return;
    }
    router.push('/r/' + target.owner + '/' + target.repo + '/scan');
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t('discoverTitle')}</h1>
          <p>{t('discoverDescription')}</p>
        </div>
      </div>
      <section className="contribution-entry">
        <label className="field-label">
          {t('ideaLabel')}
          <textarea
            aria-label={t('ideaLabel')}
            value={idea}
            maxLength={5000}
            placeholder={t('ideaPlaceholder')}
            onChange={(event) => setIdea(event.target.value)}
          />
        </label>
        <div className="inline-actions">
          <Button disabled={pending || idea.trim().length < 3} onClick={discover}>
            <Search size={16} />
            {pending ? t('working') : t('findProjects')}
          </Button>
          <span className="muted">{t('personalKeyNote')}</span>
        </div>
        <ErrorNotice
          code={error ?? task.error ?? task.data?.error ?? undefined}
          retry={task.error ? task.reload : undefined}
        />
        {pending && <p role="status">{t('discoveryPending')}</p>}
        <JobProgress job={task.data} jobId={job} />
      </section>
      <section className="direct-scan">
        <div>
          <h2>{t('haveRepository')}</h2>
          <p>{t('directScanDescription')}</p>
        </div>
        <div className="inline-actions">
          <input
            aria-label={t('repositoryLabel')}
            value={repository}
            placeholder={t('repositoryPlaceholder')}
            onChange={(event) => setRepository(event.target.value)}
          />
          <Button variant="outline" disabled={!repository.trim()} onClick={openRepository}>
            {t('openScanner')}
          </Button>
        </div>
      </section>
      {result && (
        <section className="project-matches">
          <h2>{t('matchesTitle', { count: result.projects.length })}</h2>
          <p className="muted">{result.idea}</p>
          <p className="notice">{t('discoveryEvidenceNote')}</p>
          {!result.projects.length && <p className="empty-state">{t('noProjects')}</p>}
          {result.projects.map((project) => (
            <article className="project-match" key={project.repo}>
              <div className="ai-heading">
                <h3>
                  <GitBranch size={17} />
                  {project.repo}
                </h3>
                <span className="muted">
                  {project.language ?? ''}
                  {' · '}
                  {t('starCount', { count: project.stars })}
                </span>
              </div>
              <p>{project.description}</p>
              <p>{project.reason}</p>
              <ul>
                {project.directions.map((direction) => (
                  <li key={direction}>{direction}</li>
                ))}
              </ul>
              <div className="inline-actions">
                <Button asChild>
                  <Link href={'/r/' + project.repo + '/scan?discovery=' + job}>
                    {t('scanThisProject')}
                    <ArrowRight size={15} />
                  </Link>
                </Button>
                <Link className="text-link" href={'/r/' + project.repo}>
                  {t('viewProject')}
                </Link>
              </div>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
