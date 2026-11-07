'use client';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@openself/ui/button';
import { FileText, ArrowUpRight } from 'lucide-react';
import type { DraftDTO, DraftGitHubStatus } from '@openself/shared/api';
import { api, ErrorNotice, Loading, RequestError, useResource, Pager } from './data';
import { Markdown } from './markdown';
import { IssueEditor } from './issue-editor';
import { ReviewDraftEditor } from './review-draft-editor';
import { PullRequestDraftEditor } from './pull-request-draft-editor';
import { CodeChanges } from './code-changes';
export function DraftQueue({
  initialKind = 'issue',
}: {
  initialKind?: '' | 'issue' | 'pull_request' | 'review';
}) {
  const t = useTranslations('workspace'),
    c = useTranslations('contribute'),
    f = useTranslations('drafts'),
    locale = useLocale();
  const [kind, setKind] = useState(initialKind),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);
  const [status, setStatus] = useState(''),
    [editing, setEditing] = useState<string>(),
    [busy, setBusy] = useState<string>(),
    [error, setError] = useState<string>();
  const params = new URLSearchParams({ page: String(page) });
  if (kind) params.set('kind', kind);
  if (status) params.set('status', status);
  if (query) params.set('q', query);
  const resource = useResource<{ items: DraftDTO[]; total: number; more: boolean }>(
    '/api/drafts?' + params.toString(),
    5000,
  );
  const publishedIds = (resource.data?.items ?? [])
    .filter((d) => d.status === 'published' && d.githubUrl)
    .map((d) => d.id)
    .sort()
    .join(',');
  const remote = useResource<{ items: DraftGitHubStatus[] }>(
    publishedIds ? '/api/drafts/github-status?ids=' + encodeURIComponent(publishedIds) : null,
    60000,
  );
  const states = new Map(remote.data?.items.map((item) => [item.draftId, item]));
  function remoteState(d: DraftDTO) {
    const state = states.get(d.id);
    return (
      <div className="draft-github-state">
        <span className={'status-badge github-' + (state?.state ?? 'loading')}>
          {f(d.kind === 'review' ? 'targetPR' : 'githubState')}
          {' · '}
          {state
            ? f(
                state.kind === 'pull_request' && state.state === 'closed'
                  ? 'remote.closedUnmerged'
                  : 'remote.' + state.state,
              )
            : remote.error
              ? f('remote.unavailable')
              : f('remote.loading')}
          {state?.number ? ' #' + state.number : ''}
        </span>
        {state?.checkedAt && (
          <span className="muted">
            {f('checkedAt', {
              time: new Date(state.checkedAt).toLocaleTimeString(
                locale === 'zh' ? 'zh-CN' : 'en-US',
              ),
            })}
          </span>
        )}
        {state?.error && <ErrorNotice code={state.error} />}
      </div>
    );
  }
  async function act(draft: DraftDTO, action: 'approve' | 'discard') {
    if (
      !window.confirm(
        action === 'approve'
          ? draft.kind === 'pull_request'
            ? c('confirmPR', { repo: draft.repoFullName })
            : t('confirmPublish', { repo: draft.repoFullName })
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
      <div className="filter-row draft-kind-tabs" role="group" aria-label={f('kindLabel')}>
        {(['issue', 'pull_request', 'review', ''] as const).map((value) => (
          <button
            type="button"
            key={value}
            disabled={!!editing || !!busy}
            aria-pressed={kind === value}
            className={kind === value ? 'selected' : ''}
            onClick={() => {
              setKind(value);
              setPage(1);
            }}
          >
            {f(value ? 'kind.' + value : 'allKinds')}
          </button>
        ))}
      </div>
      <div className="draft-search-row">
        <label className="field-label">
          {f('searchLabel')}
          <input
            type="search"
            aria-label={f('searchLabel')}
            value={search}
            maxLength={200}
            disabled={!!editing || !!busy}
            placeholder={f('searchHint')}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <Button
          variant="outline"
          disabled={!!editing || !!busy}
          onClick={() => {
            resource.reload();
            remote.reload();
          }}
        >
          {f('refresh')}
        </Button>
      </div>
      <p className="muted">{f('statusNote')}</p>
      <div className="filter-row" role="group" aria-label={f('publicationFilter')}>
        {['', 'draft', 'approved', 'publishing', 'published', 'failed', 'discarded'].map((s) => (
          <button
            type="button"
            key={s}
            disabled={!!editing || !!busy}
            aria-pressed={status === s}
            onClick={() => {
              setStatus(s);
              setPage(1);
            }}
            className={status === s ? 'selected' : ''}
          >
            {t(s ? 'status.' + s : 'all')}
          </button>
        ))}
      </div>
      <ErrorNotice
        code={error ?? resource.error}
        retry={resource.error ? resource.reload : undefined}
      />
      {publishedIds && remote.error && (
        <p className="notice" role="alert">
          {f('remoteFailed')}
        </p>
      )}
      {resource.loading && !resource.error && <Loading />}
      {resource.data && <p className="muted">{f('results', { count: resource.data.total })}</p>}
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
                <small>{f('kind.' + d.kind)}</small>
              </div>
              <span className={'status-badge status-' + d.status}>
                {f('publication')}
                {' · '}
                {t('status.' + d.status)}
              </span>
            </header>
            {d.status === 'published' && d.githubUrl && remoteState(d)}
            <ErrorNotice code={d.error ?? undefined} />
            {editing === d.id ? (
              <>
                {d.kind === 'pull_request' ? (
                  <PullRequestDraftEditor
                    draft={d}
                    onSaved={() => {
                      setEditing(undefined);
                      resource.reload();
                    }}
                  />
                ) : d.kind === 'review' ? (
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
                {d.kind === 'pull_request' && (
                  <div>
                    <p>
                      {c('sourceCommit', {
                        sha: d.payloadJson.baseSha.slice(0, 8),
                        branch: d.payloadJson.baseBranch,
                      })}
                    </p>
                    <p className="notice">
                      {d.payloadJson.asDraft ? c('createDraftPR') : c('createReadyPR')}
                    </p>
                    <p>{c('forkNotice')}</p>
                    <CodeChanges files={d.payloadJson.files} />
                  </div>
                )}
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
          <p className="empty-state">{f('emptyFiltered')}</p>
        )}
      </div>
      {resource.data && !editing && (
        <Pager page={page} more={resource.data.more} onChange={setPage} />
      )}
    </>
  );
}
