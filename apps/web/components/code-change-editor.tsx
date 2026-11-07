'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@openself/ui/button';
import type { PreparedChange } from '@openself/shared/contributions';
import type { DraftDTO } from '@openself/shared/api';
import { Link } from '../i18n/navigation';
import { CodeChanges } from './code-changes';
import { api, ErrorNotice, RequestError } from './data';
import { useAIJob } from './use-ai-job';
export function CodeChangeEditor({ jobId }: { jobId: string }) {
  const t = useTranslations('contribute'),
    w = useTranslations('workspace');
  const task = useAIJob(jobId);
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
              <Link className="text-link" href="/drafts">
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
