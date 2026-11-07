'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@openself/ui/button';
import type { DiscoveryResult, RepositoryScanResult } from '@openself/shared/contributions';
import type { JobDTO } from '@openself/shared/ai';
import { Link, useRouter } from '../i18n/navigation';
import { api, ErrorNotice, RequestError, useResource } from './data';
import { useAIJob } from './use-ai-job';

export function RepositoryScan({
  repo,
  initialJobId,
  discoveryId,
}: {
  repo: string;
  initialJobId?: string;
  discoveryId?: string;
}) {
  const t = useTranslations('contribute'),
    router = useRouter();
  const [goal, setGoal] = useState(''),
    [maxFiles, setMaxFiles] = useState(20);
  const [instruction, setInstruction] = useState(''),
    [job, setJob] = useState(initialJobId);
  const [busy, setBusy] = useState(false),
    [preparing, setPreparing] = useState(false),
    [error, setError] = useState<string>();
  const idea = useResource<JobDTO>(
    discoveryId ? '/api/jobs/' + encodeURIComponent(discoveryId) : null,
  );
  const task = useAIJob(job);
  const result =
    task.data?.kind === 'repository.scan' && task.data.status === 'done'
      ? (task.data.resultJson as RepositoryScanResult)
      : undefined;
  useEffect(() => setJob(initialJobId), [initialJobId]);
  useEffect(() => {
    if (idea.data?.kind === 'discovery.find' && idea.data.status === 'done')
      setGoal((value) => value || (idea.data!.resultJson as DiscoveryResult).idea.slice(0, 4000));
  }, [idea.data]);
  const pending =
    busy || (!!job && (!task.data || ['queued', 'running'].includes(task.data.status)));
  async function start() {
    setBusy(true);
    setError(undefined);
    try {
      const response = await api<{ jobId: string }>('/api/scan-repository', {
        method: 'POST',
        body: JSON.stringify({ repo, goal, maxFiles }),
      });
      setJob(response.jobId);
      router.replace('/r/' + repo + '/scan?job=' + response.jobId);
    } catch (e) {
      setError(e instanceof RequestError ? e.code : 'unknown');
    } finally {
      setBusy(false);
    }
  }
  async function prepare(findingId: string) {
    setPreparing(true);
    setError(undefined);
    try {
      const response = await api<{ jobId: string }>('/api/prepare-change', {
        method: 'POST',
        body: JSON.stringify({ scanJobId: job, findingId, instruction }),
      });
      router.push('/changes/' + response.jobId);
    } catch (e) {
      setError(e instanceof RequestError ? e.code : 'unknown');
    } finally {
      setPreparing(false);
    }
  }
  const reason = (value: string) => (t.has('skip.' + value) ? t('skip.' + value) : t('skip.other'));
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{repo}</div>
          <h1>{t('scanTitle')}</h1>
          <p>{t('scanDescription')}</p>
        </div>
        <Button asChild variant="outline">
          <Link href={'/r/' + repo}>{t('viewProject')}</Link>
        </Button>
      </div>
      <section className="contribution-entry">
        <label className="field-label">
          {t('scanGoal')}
          <textarea
            aria-label={t('scanGoal')}
            value={goal}
            maxLength={4000}
            onChange={(event) => setGoal(event.target.value)}
          />
        </label>
        <div className="inline-actions">
          <label className="field-label">
            {t('fileBudget')}
            <select
              aria-label={t('fileBudget')}
              value={maxFiles}
              onChange={(event) => setMaxFiles(Number(event.target.value))}
            >
              {[10, 20, 50, 100].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <Button disabled={pending} onClick={start}>
            {pending ? t('working') : t('startScan')}
          </Button>
        </div>
        <p className="muted">{t('scanBudgetNote')}</p>
        <ErrorNotice
          code={error ?? task.error ?? task.data?.error ?? undefined}
          retry={task.error ? task.reload : undefined}
        />
        {pending && <p role="status">{t('scanPending')}</p>}
      </section>
      {result && result.repo === repo.toLowerCase() && (
        <section className="scan-report">
          <h2>{t('scanResults')}</h2>
          <p>
            {t('coverage', {
              count: result.examinedFiles,
              eligible: result.eligibleFiles,
              skipped: result.skippedCount,
            })}
          </p>
          <p className="muted">
            {t('sourceCommit', { sha: result.baseSha.slice(0, 8), branch: result.baseBranch })}
          </p>
          <p className="notice">{t('candidateNote')}</p>
          {result.treeTruncated && <p className="notice">{t('treeTruncated')}</p>}
          <details className="scan-coverage">
            <summary>{t('inspectCoverage')}</summary>
            {result.scanned.map((file) => (
              <p key={file.path}>
                {file.path +
                  ' · ' +
                  t('lineCoverage', { count: file.lines, total: file.totalLines })}
                {file.partial ? ' · ' + t('partialFile') : ''}
              </p>
            ))}
            {result.skipped.map((file, index) => (
              <p key={file.path + index}>{file.path + ' · ' + reason(file.reason)}</p>
            ))}
          </details>
          {result.findings.length > 0 && (
            <label className="field-label">
              {t('changeInstruction')}
              <textarea
                value={instruction}
                maxLength={3000}
                onChange={(event) => setInstruction(event.target.value)}
              />
            </label>
          )}
          {!result.findings.length && <p className="empty-state">{t('noFindings')}</p>}
          {result.findings.map((finding) => (
            <article className="scan-finding" key={finding.id}>
              <div className="finding-meta">
                <span>{t('kind.' + finding.kind)}</span>
                <a href={finding.sourceUrl} target="_blank" rel="noreferrer">
                  {finding.path + ':' + finding.line}
                </a>
              </div>
              <h3>{finding.title}</h3>
              <p>{finding.explanation}</p>
              <pre>{finding.evidence}</pre>
              <p>{finding.suggestion}</p>
              <h4>{t('verificationPlan')}</h4>
              <ul>
                {finding.verification.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
              {finding.relatedIssues.map((number) => {
                const issue = result.relatedIssues.find((item) => item.number === number);
                return issue ? (
                  <p key={number}>
                    <a href={issue.url} target="_blank" rel="noreferrer">
                      {'#' + number + ' ' + issue.title}
                    </a>
                  </p>
                ) : null;
              })}
              <div className="inline-actions">
                <Button
                  disabled={preparing || result.treeTruncated}
                  onClick={() => prepare(finding.id)}
                >
                  {preparing ? t('working') : t('prepareCode')}
                </Button>
                <Button asChild variant="outline">
                  <Link href={'/r/' + repo + '/issues/new?scan=' + job + '&finding=' + finding.id}>
                    {t('draftIssue')}
                  </Link>
                </Button>
              </div>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
