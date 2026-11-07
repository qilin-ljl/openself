'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@openself/ui/button';
import type { PreparedChange } from '@openself/shared/contributions';
import type { DraftDTO } from '@openself/shared/api';
import { Link, useRouter } from '../i18n/navigation';
import { CodeChanges } from './code-changes';
import { api, ErrorNotice, RequestError, useResource } from './data';
import { useAIJob } from './use-ai-job';
import { JobProgress } from './job-progress';
export function CodeChangeEditor({ jobId }: { jobId: string }) {
  const t = useTranslations('contribute'),
    w = useTranslations('workspace'),
    router = useRouter();
  const task = useAIJob(jobId);
  const source =
    task.data?.kind === 'change.prepare'
      ? (task.data.input as
          { scanJobId: string; findingId: string; instruction?: string } | undefined)
      : undefined;
  const context = useResource<{ repo: string; title: string }>(
    source
      ? '/api/scans/' +
          encodeURIComponent(source.scanJobId) +
          '/findings/' +
          encodeURIComponent(source.findingId)
      : null,
  );
  const diagnostic = (
    task.data?.resultJson as {
      changeDiagnostic?: { code: string; reason: string; files: string[] };
    } | null
  )?.changeDiagnostic;
  const [instruction, setInstruction] = useState(''),
    [preparing, setPreparing] = useState(false);
  useEffect(() => {
    if (source) setInstruction(source.instruction ?? '');
  }, [task.data?.id]);
  const result =
    task.data?.kind === 'change.prepare' && task.data.status === 'done'
      ? (task.data.resultJson as PreparedChange)
      : undefined;
  const [title, setTitle] = useState<string>(),
    [body, setBody] = useState<string>(),
    [asDraft, setAsDraft] = useState(true);
  const [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [error, setError] = useState<string>();
  async function prepareAgain() {
    if (!source) return;
    setPreparing(true);
    setError(undefined);
    try {
      const response = await api<{ jobId: string }>('/api/prepare-change', {
        method: 'POST',
        body: JSON.stringify({
          scanJobId: source.scanJobId,
          findingId: source.findingId,
          instruction,
        }),
      });
      router.push('/changes/' + response.jobId);
    } catch (e) {
      setError(e instanceof RequestError ? e.code : 'unknown');
    } finally {
      setPreparing(false);
    }
  }
  async function save() {
    if (!result) return;
    setBusy(true);
    setError(undefined);
    try {
      await api<DraftDTO>('/api/drafts', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'pull_request',
          repo: result.repo,
          payload: {
            changeJobId: jobId,
            title: title ?? result.title,
            body: body ?? result.body,
            asDraft,
          },
        }),
      });
      setSaved(true);
    } catch (e) {
      setError(e instanceof RequestError ? e.code : 'unknown');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t('changeTitle')}</h1>
          <p>{t('changeDescription')}</p>
        </div>
      </div>
      <ErrorNotice
        code={error ?? task.error ?? task.data?.error ?? undefined}
        retry={task.error ? task.reload : undefined}
      />
      <JobProgress job={task.data} jobId={jobId} />
      {task.data && ['failed', 'cancelled'].includes(task.data.status) && (
        <section className="contribution-entry">
          {context.data && <h2>{context.data.title}</h2>}
          <p>{t('changeFailedNote')}</p>
          {diagnostic?.reason ? (
            <>
              <h3>{t('changeExplanation')}</h3>
              <p className="change-diagnostic">{diagnostic.reason}</p>
            </>
          ) : (
            <p className="muted">{t('legacyChangeFailure')}</p>
          )}
          {!!diagnostic?.files.length && (
            <p className="muted">
              {t('changeContextFiles', { files: diagnostic.files.join(', ') })}
            </p>
          )}
          {source && (
            <>
              <label className="field-label">
                {t('changeInstruction')}
                <textarea
                  maxLength={3000}
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                />
              </label>
              <div className="inline-actions">
                <Button disabled={preparing} onClick={prepareAgain}>
                  {preparing ? t('working') : t('prepareAgain')}
                </Button>
                {context.data && (
                  <>
                    <Link href={'/r/' + context.data.repo + '/scan?job=' + source.scanJobId}>
                      {t('backToScan')}
                    </Link>
                    <Link
                      href={
                        '/r/' +
                        context.data.repo +
                        '/issues/new?scan=' +
                        source.scanJobId +
                        '&finding=' +
                        source.findingId
                      }
                    >
                      {t('draftIssue')}
                    </Link>
                  </>
                )}
              </div>
            </>
          )}
          <ErrorNotice code={context.error} />
        </section>
      )}
      {(!task.data || ['queued', 'running'].includes(task.data.status)) && (
        <p role="status">{t('codePending')}</p>
      )}
      {result && (
        <section className="change-preview">
          <p className="eyebrow">{result.repo}</p>
          <p>{t('sourceCommit', { sha: result.baseSha.slice(0, 8), branch: result.baseBranch })}</p>
          <p className="notice">{t('testsNotRun')}</p>
          <p className="muted">{t('forkNotice')}</p>
          <CodeChanges files={result.files} />
          <label className="field-label">
            {w('title')}
            <input
              value={title ?? result.title}
              maxLength={200}
              onChange={(event) => {
                setTitle(event.target.value);
                setSaved(false);
              }}
            />
          </label>
          <label className="field-label">
            {w('body')}
            <textarea
              className="body-editor"
              value={body ?? result.body}
              maxLength={60000}
              onChange={(event) => {
                setBody(event.target.value);
                setSaved(false);
              }}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={asDraft}
              onChange={(event) => {
                setAsDraft(event.target.checked);
                setSaved(false);
              }}
            />
            {t('asDraft')}
          </label>
          <div className="inline-actions">
            <Button
              disabled={
                busy || saved || !(title ?? result.title).trim() || !(body ?? result.body).trim()
              }
              onClick={save}
            >
              {busy ? t('working') : t('savePRDraft')}
            </Button>
            {saved && (
              <Link className="text-link" href="/drafts?kind=pull_request">
                {w('viewDrafts')}
              </Link>
            )}
            <Link href={'/r/' + result.repo + '/scan?job=' + result.scanJobId}>
              {t('backToScan')}
            </Link>
          </div>
        </section>
      )}
    </>
  );
}
