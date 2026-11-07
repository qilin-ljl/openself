'use client';
import { useEffect, useState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@openself/ui/button';
import type {
  DiscoveryResult,
  RepositoryScanResult,
  RepositoryPlan,
} from '@openself/shared/contributions';
import type { JobDTO } from '@openself/shared/ai';
import { Link, useRouter } from '../i18n/navigation';
import { api, ErrorNotice, RequestError, useResource } from './data';
import { useAIJob } from './use-ai-job';
import { JobProgress } from './job-progress';

export function RepositoryScan({
  repo,
  initialJobId,
  discoveryId,
  initialPlanId,
}: {
  repo: string;
  initialJobId?: string;
  discoveryId?: string;
  initialPlanId?: string;
}) {
  const t = useTranslations('contribute'),
    router = useRouter();
  const [goal, setGoal] = useState(''),
    [maxFiles, setMaxFiles] = useState(20);
  const [mode, setMode] = useState<'fast' | 'deep'>('fast'),
    [focus, setFocus] = useState<'both' | 'bugs' | 'opportunities'>('both');
  const [planJob, setPlanJob] = useState(initialPlanId),
    [selected, setSelected] = useState<string[]>([]),
    [extraPaths, setExtraPaths] = useState('');
  const planTask = useAIJob(planJob);
  const plan =
    planTask.data?.status === 'done' && planTask.data.kind === 'repository.plan'
      ? (planTask.data.resultJson as RepositoryPlan)
      : undefined;
  const restored = useRef('');
  useEffect(() => setPlanJob(initialPlanId), [initialPlanId]);
  useEffect(() => {
    if (plan && !initialJobId) {
      setGoal(plan.goal);
      setSelected(plan.files.slice(0, maxFiles).map((file) => file.path));
    }
  }, [plan, initialJobId]);

  const [instruction, setInstruction] = useState(''),
    [job, setJob] = useState(initialJobId);
  const [busy, setBusy] = useState(false),
    [preparing, setPreparing] = useState(false),
    [error, setError] = useState<string>();
  const idea = useResource<JobDTO>(
    discoveryId ? '/api/jobs/' + encodeURIComponent(discoveryId) : null,
  );
  const task = useAIJob(job);
  const raw = task.data?.resultJson as RepositoryScanResult | undefined;
  const result =
    task.data?.kind === 'repository.scan' &&
    raw?.repo === repo.toLowerCase() &&
    Array.isArray(raw.scanned)
      ? raw
      : undefined;
  useEffect(() => {
    if (task.data && restored.current !== task.data.id) {
      const input = task.data.input as
        | {
            goal?: string;
            maxFiles?: number;
            mode?: 'fast' | 'deep';
            focus?: 'both' | 'bugs' | 'opportunities';
            planJobId?: string;
            selectedPaths?: string[];
          }
        | undefined;
      if (input) {
        setGoal(input.goal ?? '');
        setMaxFiles(input.maxFiles ?? 20);
        setMode(input.mode ?? 'fast');
        setFocus(input.focus ?? 'both');
        setPlanJob(input.planJobId);
        if (input.selectedPaths) setSelected(input.selectedPaths);
      }
      restored.current = task.data.id;
    }
  }, [task.data]);
  useEffect(() => setJob(initialJobId), [initialJobId]);
  useEffect(() => {
    if (idea.data?.kind === 'discovery.find' && idea.data.status === 'done')
      setGoal((value) => value || (idea.data!.resultJson as DiscoveryResult).idea.slice(0, 4000));
  }, [idea.data]);
  const pending =
    busy ||
    (!!job && !task.error && (!task.data || ['queued', 'running'].includes(task.data.status)));
  const planning =
    !!planJob &&
    !planTask.error &&
    (!planTask.data || ['queued', 'running'].includes(planTask.data.status));
  const selectedPaths = [
    ...new Set([
      ...selected,
      ...extraPaths
        .split('\n')
        .map((path) => path.trim())
        .filter(Boolean),
    ]),
  ];
  async function makePlan() {
    setBusy(true);
    setError(undefined);
    try {
      const response = await api<{ jobId: string }>('/api/plan-repository', {
        method: 'POST',
        body: JSON.stringify({ repo, goal, maxFiles, mode, focus }),
      });
      setPlanJob(response.jobId);
      setJob(undefined);
      router.replace('/r/' + repo + '/scan?plan=' + response.jobId);
    } catch (e) {
      setError(e instanceof RequestError ? e.code : 'unknown');
    } finally {
      setBusy(false);
    }
  }
  async function start(chosenMode = mode, paths = selectedPaths) {
    setBusy(true);
    setError(undefined);
    try {
      const response = await api<{ jobId: string }>('/api/scan-repository', {
        method: 'POST',
        body: JSON.stringify({
          repo,
          goal,
          maxFiles,
          mode: chosenMode,
          focus,
          planJobId: planJob,
          selectedPaths: paths,
        }),
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
        <p className="notice">{t('planFirst')}</p>
        <label className="field-label">
          {t('scanGoal')}
          <textarea
            aria-label={t('scanGoal')}
            value={goal}
            maxLength={4000}
            onChange={(event) => {
              setGoal(event.target.value);
              setPlanJob(undefined);
              setSelected([]);
            }}
          />
        </label>
        <div className="inline-actions">
          <label className="field-label">
            {t('mode')}
            <select value={mode} onChange={(e) => setMode(e.target.value as 'fast' | 'deep')}>
              <option value="fast">{t('fast')}</option>
              <option value="deep">{t('deep')}</option>
            </select>
          </label>
          <label className="field-label">
            {t('focus')}
            <select
              value={focus}
              onChange={(e) => {
                setFocus(e.target.value as 'both' | 'bugs' | 'opportunities');
                setPlanJob(undefined);
              }}
            >
              <option value="both">{t('both')}</option>
              <option value="bugs">{t('bugs')}</option>
              <option value="opportunities">{t('opportunities')}</option>
            </select>
          </label>
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
          <Button variant="outline" disabled={pending || planning} onClick={makePlan}>
            {planning ? t('working') : t('makePlan')}
          </Button>
          <Button
            disabled={
              pending ||
              planning ||
              !plan ||
              !selectedPaths.length ||
              selectedPaths.length > maxFiles
            }
            onClick={() => start()}
          >
            {pending ? t('working') : t('startSelected')}
          </Button>
        </div>
        <p className="muted">{t('scanBudgetNote')}</p>
        <ErrorNotice
          code={
            error ??
            task.error ??
            planTask.error ??
            task.data?.error ??
            planTask.data?.error ??
            undefined
          }
          retry={task.error ? task.reload : undefined}
        />
        <JobProgress job={planTask.data} jobId={planJob} />
        <JobProgress job={task.data} jobId={job} />
        {plan && (
          <div className="scan-plan">
            <h2>{t('planTitle')}</h2>
            <p>{plan.summary}</p>
            <p className="muted">
              {t('sourceCommit', { sha: plan.baseSha.slice(0, 8), branch: plan.baseBranch })}
            </p>
            {plan.modules.map((module) => (
              <p key={module.name}>
                <strong>{module.name}</strong>
                {' · ' + module.purpose}
              </p>
            ))}
            <p>{t('selectedCount', { count: selectedPaths.length, max: maxFiles })}</p>
            <div className="plan-files">
              {plan.files.map((file) => (
                <label className="plan-file" key={file.path}>
                  <input
                    type="checkbox"
                    checked={selected.includes(file.path)}
                    onChange={(e) =>
                      setSelected((value) =>
                        e.target.checked
                          ? [...value, file.path]
                          : value.filter((path) => path !== file.path),
                      )
                    }
                  />
                  <span>
                    <strong>{file.path}</strong>
                    <small>{file.role + ' · ' + file.reason}</small>
                  </span>
                </label>
              ))}
            </div>
            <label className="field-label">
              {t('extraPaths')}
              <textarea
                value={extraPaths}
                onChange={(e) => setExtraPaths(e.target.value)}
                placeholder={t('extraPathsHint')}
              />
            </label>
          </div>
        )}
      </section>
      {result && result.repo === repo.toLowerCase() && (
        <section className="scan-report">
          <h2>{t('scanResults')}</h2>
          {task.data?.status !== 'done' && <p className="notice">{t('liveReport')}</p>}
          {!!result.reusedBatches && <p>{t('reused', { count: result.reusedBatches })}</p>}
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
          {!!result.plan?.documents.length && (
            <p className="muted">{t('contextDocs', { paths: result.plan.documents.join(', ') })}</p>
          )}
          {!!result.analysisFailedFiles && (
            <p className="notice" role="alert">
              {t('analysisIncomplete', { count: result.analysisFailedFiles })}
            </p>
          )}
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
            {result.ranges?.map((range) => (
              <p key={range.path + ':' + range.start}>
                {range.path + ': ' + range.start + '–' + range.end}
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
          {!result.findings.length && result.examinedFiles > 0 && (
            <p className="empty-state">{t('noFindings')}</p>
          )}
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
              {finding.discussionOnly && <p className="notice">{t('discussionOnly')}</p>}
              {finding.audience && (
                <p>
                  <strong>{t('audience')}</strong>
                  {' · ' + finding.audience}
                </p>
              )}
              {finding.benefit && (
                <p>
                  <strong>{t('benefit')}</strong>
                  {' · ' + finding.benefit}
                </p>
              )}
              {finding.tradeoffs && (
                <p>
                  <strong>{t('tradeoffs')}</strong>
                  {' · ' + finding.tradeoffs}
                </p>
              )}
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
                  disabled={preparing || result.treeTruncated || task.data?.status !== 'done'}
                  onClick={() => prepare(finding.id)}
                >
                  {preparing ? t('working') : t('prepareCode')}
                </Button>
                {task.data?.status === 'done' && (
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => start('deep', [finding.path])}
                  >
                    {t('deepen')}
                  </Button>
                )}
                {task.data?.status === 'done' && (
                  <Button asChild variant="outline">
                    <Link
                      href={'/r/' + repo + '/issues/new?scan=' + job + '&finding=' + finding.id}
                    >
                      {t('draftIssue')}
                    </Link>
                  </Button>
                )}
              </div>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
