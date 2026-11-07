'use client';
import { useTranslations } from 'next-intl';
import type { JobDTO, JobProgress as Progress } from '@openself/shared/ai';
import { Link } from '../i18n/navigation';
export function JobProgress({ job, jobId }: { job?: JobDTO; jobId?: string }) {
  const t = useTranslations('tasks');
  if (!jobId) return null;
  const progress = (job?.resultJson as { progress?: Progress } | null)?.progress;
  return (
    <div className="job-progress" role="status">
      <div className="inline-actions">
        <strong>
          {job
            ? t(t.has('status.' + job.status) ? 'status.' + job.status : 'status.running')
            : t('loading')}
        </strong>
        <Link href={'/tasks/' + jobId}>{t('details')}</Link>
      </div>
      {progress && (
        <p>
          {t(t.has('stage.' + progress.stage) ? 'stage.' + progress.stage : 'stage.starting')}
          {progress.total !== undefined
            ? ' · ' + (progress.completed ?? 0) + ' / ' + progress.total
            : ''}
          {progress.cached ? ' · ' + t('cached', { count: progress.cached }) : ''}
        </p>
      )}
      {progress?.total !== undefined && progress.total > 0 && (
        <progress value={progress.completed ?? 0} max={progress.total} />
      )}
      {progress?.current && <p className="muted">{progress.current}</p>}
      {job && ['queued', 'running'].includes(job.status) && (
        <p className="muted">{t('leaveNote')}</p>
      )}
    </div>
  );
}
