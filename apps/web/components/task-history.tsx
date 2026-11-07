'use client';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@openself/ui/button';
import type { JobListItem, JobDTO } from '@openself/shared/ai';
import { api, ErrorNotice, RequestError, useResource, Pager } from './data';
import { Link } from '../i18n/navigation';
import { JobProgress } from './job-progress';
import { Markdown } from './markdown';
import { useAIJob } from './use-ai-job';
function Actions({
  job,
  reload,
}: {
  job: Pick<JobDTO, 'id' | 'status'> & { incomplete?: boolean };
  reload: () => void;
}) {
  const t = useTranslations('tasks'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  async function act(action: 'cancel' | 'retry') {
    setBusy(true);
    setError(undefined);
    try {
      await api('/api/jobs/' + job.id + '/' + action, { method: 'POST' });
      reload();
    } catch (e) {
      setError(e instanceof RequestError ? e.code : 'unknown');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="inline-actions">
        {['queued', 'running'].includes(job.status) ? (
          <Button variant="outline" disabled={busy} onClick={() => act('cancel')}>
            {t('cancel')}
          </Button>
        ) : ['failed', 'cancelled'].includes(job.status) || job.incomplete ? (
          <Button disabled={busy} onClick={() => act('retry')}>
            {t(job.incomplete ? 'retryFailed' : 'retry')}
          </Button>
        ) : null}
      </div>
      <ErrorNotice code={error} />
    </>
  );
}
export function TaskHistory({ compact = false }: { compact?: boolean }) {
  const t = useTranslations('tasks'),
    locale = useLocale(),
    [page, setPage] = useState(1);
  const r = useResource<{ items: JobListItem[]; more: boolean }>('/api/jobs?page=' + page, 5000);
  return (
    <section className="task-history">
      <div className="page-heading">
        <div>
          <h2>{t(compact ? 'recent' : 'title')}</h2>
          <p>{t('description')}</p>
        </div>
        {compact && <Link href="/tasks">{t('viewAll')}</Link>}
      </div>
      <ErrorNotice code={r.error} retry={r.reload} />
      {!r.data && !r.error && <p>{t('loading')}</p>}
      {r.data && !r.data.items.length && <p className="empty-state">{t('empty')}</p>}
      {(compact ? r.data?.items.slice(0, 6) : r.data?.items)?.map((job) => (
        <article className="task-card" key={job.id}>
          <div>
            <Link href={job.href}>
              <strong>{t(t.has('kind.' + job.kind) ? 'kind.' + job.kind : 'kind.other')}</strong>
              {job.repo ? ' · ' + job.repo : ''}
            </Link>
            <p className="muted">
              {job.createdAt
                ? new Date(job.createdAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')
                : ''}
              {job.durationMs !== undefined
                ? ' · ' + t('seconds', { count: Math.round(job.durationMs / 1000) })
                : ''}
            </p>
          </div>
          <span className={'task-status status-' + job.status}>
            {t('status.' + job.status)}
            {job.incomplete ? ' · ' + t('incomplete') : ''}
          </span>
          {job.progress && (
            <p>
              {t(
                t.has('stage.' + job.progress.stage)
                  ? 'stage.' + job.progress.stage
                  : 'stage.starting',
              )}
              {job.progress.total !== undefined
                ? ' ' + (job.progress.completed ?? 0) + ' / ' + job.progress.total
                : ''}
            </p>
          )}
          <Actions job={job} reload={r.reload} />
        </article>
      ))}
      {!compact && r.data && <Pager page={page} more={r.data.more} onChange={setPage} />}
    </section>
  );
}
export function TaskDetail({ id }: { id: string }) {
  const t = useTranslations('tasks'),
    r = useAIJob(id),
    job = r.data;
  const input = job?.input as { repo?: string; prNumber?: number; planJobId?: string } | undefined;
  const result = job?.resultJson as {
    title?: string;
    body?: string;
    text?: string;
    summary?: string;
    analysisFailedFiles?: number;
    findings?: unknown[];
    missingInfo?: { field: string; question: string }[];
  } | null;
  const repo = input?.repo;
  const href = !job
    ? null
    : job.kind === 'discovery.find'
      ? '/contribute?job=' + id
      : repo && job.kind === 'repository.plan'
        ? '/r/' + repo + '/scan?plan=' + id
        : repo && job.kind === 'repository.scan'
          ? '/r/' + repo + '/scan?job=' + id
          : job.kind === 'change.prepare'
            ? '/changes/' + id
            : repo && job.kind.startsWith('issue.')
              ? '/r/' + repo + '/issues/new?job=' + id
              : repo && input?.prNumber
                ? '/r/' + repo + '/pull/' + input.prNumber
                : null;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t('details')}</h1>
          <p>
            {job ? t(t.has('kind.' + job.kind) ? 'kind.' + job.kind : 'kind.other') : t('loading')}
            {repo ? ' · ' + repo : ''}
          </p>
        </div>
        <Link href="/tasks">{t('viewAll')}</Link>
      </div>
      <ErrorNotice code={r.error ?? job?.error ?? undefined} retry={r.reload} />
      <JobProgress job={job} jobId={id} />
      {job && (
        <Actions job={{ ...job, incomplete: !!result?.analysisFailedFiles }} reload={r.reload} />
      )}
      {href && (
        <Button asChild>
          <Link href={href}>{t('openResult')}</Link>
        </Button>
      )}
      {job && ['failed', 'cancelled'].includes(job.status) && (
        <p className="notice">{t('resumeNote')}</p>
      )}
      {result?.analysisFailedFiles ? <p className="notice">{t('incomplete')}</p> : null}
      {job?.status === 'done' && result && (
        <div className="task-result">
          {result.title && <h2>{result.title}</h2>}
          {(result.body ?? result.text ?? result.summary) && (
            <Markdown body={result.body ?? result.text ?? result.summary ?? ''} />
          )}
          {result.missingInfo?.map((item) => (
            <p key={item.field}>{item.question}</p>
          ))}
        </div>
      )}
    </>
  );
}
