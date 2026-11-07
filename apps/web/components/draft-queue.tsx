'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@openself/ui/button';
import { FileText, ArrowUpRight } from 'lucide-react';
import type { DraftDTO } from '@openself/shared/api';
import { api, ErrorNotice, Loading, RequestError, useResource } from './data';
import { Markdown } from './markdown';
import { IssueEditor } from './issue-editor';
import { ReviewDraftEditor } from './review-draft-editor';
export function DraftQueue() {
  const t = useTranslations('workspace');
  const [status, setStatus] = useState(''),
    [editing, setEditing] = useState<string>(),
    [busy, setBusy] = useState<string>(),
    [error, setError] = useState<string>();
  const resource = useResource<{ items: DraftDTO[] }>(
    '/api/drafts' + (status ? '?status=' + status : ''),
    2000,
  );
  async function act(draft: DraftDTO, action: 'approve' | 'discard') {
    if (
      !window.confirm(
        action === 'approve'
          ? t('confirmPublish', { repo: draft.repoFullName })
          : t('confirmDiscard'),
      )
    )
      return;
    if (
      action === 'approve' &&
      draft.kind === 'review' &&
      draft.payloadJson.event !== 'COMMENT' &&
      !window.confirm(t('confirmDecision', { event: t(draft.payloadJson.event) }))
    )
      return;
    setBusy(draft.id);
    setError(undefined);
    try {
      await api('/api/drafts/' + draft.id + (action === 'approve' ? '/approve' : ''), {
        method: action === 'approve' ? 'POST' : 'DELETE',
      });
      resource.reload();
    } catch (e) {
      setError(e instanceof RequestError ? e.code : 'unknown');
    } finally {
      setBusy(undefined);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t('navDrafts')}</h1>
          <p>{t('draftsDescription')}</p>
        </div>
      </div>
      <div className="filter-row">
        {['', 'draft', 'approved', 'publishing', 'published', 'failed', 'discarded'].map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={status === s ? 'selected' : ''}>
            {t(s ? 'status.' + s : 'all')}
          </button>
        ))}
      </div>
      <ErrorNotice
        code={error ?? resource.error}
        retry={resource.error ? resource.reload : undefined}
      />
      {resource.loading && <Loading />}
      <div className="draft-list">
        {resource.data?.items.map((d) => (
          <article className="draft-card" key={d.id}>
            <header>
              <div>
                <span className="eyebrow">
                  <FileText size={14} />
                  {d.repoFullName}
                </span>
                <h2>{d.payloadJson.title}</h2>
              </div>
              <span className={'status-badge status-' + d.status}>{t('status.' + d.status)}</span>
            </header>
            <ErrorNotice code={d.error ?? undefined} />
            {editing === d.id ? (
              <>
                {d.kind === 'review' ? (
                  <ReviewDraftEditor
                    draft={d}
                    onSaved={() => {
                      setEditing(undefined);
                      resource.reload();
                    }}
                  />
                ) : (
                  <IssueEditor
                    repoFullName={d.repoFullName}
                    initial={d}
                    onSaved={() => {
                      setEditing(undefined);
                      resource.reload();
                    }}
                  />
                )}
                <Button variant="ghost" onClick={() => setEditing(undefined)}>
                  {t('cancel')}
                </Button>
              </>
            ) : (
              <details>
                <summary>{t('preview')}</summary>
                <Markdown body={d.payloadJson.body} />
                {d.kind === 'review' && (
                  <div className="review-preview">
                    <strong>{t(d.payloadJson.event)}</strong>
                    <p className="muted">
                      {t('reviewSha', { sha: d.payloadJson.headSha.slice(0, 8) })}
                    </p>
                    {d.payloadJson.comments.map((c, index) => (
                      <div className="review-preview-comment" key={index}>
                        <strong>{c.path + ':' + c.line + ' (' + c.side + ')'}</strong>
                        <Markdown body={c.body} />
                      </div>
                    ))}
                  </div>
                )}
              </details>
            )}
            <footer>
              <div className="inline-actions">
                {['draft', 'failed'].includes(d.status) && (
                  <>
                    <Button
                      variant="outline"
                      disabled={busy === d.id}
                      onClick={() => setEditing(d.id)}
                    >
                      {t('edit')}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy === d.id}
                      onClick={() => act(d, 'discard')}
                    >
                      {t('discard')}
                    </Button>
                  </>
                )}
                {d.status === 'draft' && (
                  <Button disabled={busy === d.id} onClick={() => act(d, 'approve')}>
                    {t('approve')}
                  </Button>
                )}
                {d.status === 'approved' && (
                  <span className="muted">{t('pendingPublication')}</span>
                )}
              </div>
              {d.githubUrl && (
                <a className="text-link" href={d.githubUrl} target="_blank" rel="noreferrer">
                  {t('openGithub')}
                  <ArrowUpRight size={16} />
                </a>
              )}
            </footer>
          </article>
        ))}
        {resource.data && !resource.data.items.length && (
          <p className="empty-state">{t('emptyDrafts')}</p>
        )}
      </div>
    </>
  );
}
