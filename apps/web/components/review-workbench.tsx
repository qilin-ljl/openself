'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useLocale, useTranslations } from 'next-intl';
import { GitPullRequest, ArrowUpRight, FileCode, Plus } from 'lucide-react';
import { Button } from '@openself/ui/button';
import type { GitHubClient } from '@openself/github';
import { parsePatch, isCommentable } from '@openself/github/diff';
import type { ReviewComment, DraftDTO } from '@openself/shared/api';
import { Link } from '../i18n/navigation';
import { api, useResource, ErrorNotice, RequestError, Loading } from './data';
import { Markdown } from './markdown';
import { AIReviewPanel } from './ai-review-panel';
const DiffCanvas = dynamic(() => import('./diff-canvas'), { ssr: false });
type Detail = {
  pull: Awaited<ReturnType<GitHubClient['getPull']>>;
  files: Awaited<ReturnType<GitHubClient['listPullFiles']>>['files'];
  truncated: boolean;
  checks: Awaited<ReturnType<GitHubClient['getCheckRuns']>>['check_runs'];
  checksUnavailable: boolean;
  viewerLogin: string;
};
export function ReviewWorkbench({ owner, repo, n }: { owner: string; repo: string; n: number }) {
  const t = useTranslations('workspace'),
    locale = useLocale(),
    resource = useResource<Detail>('/api/repos/' + owner + '/' + repo + '/pulls/' + n);
  const [selected, setSelected] = useState(''),
    [risk, setRisk] = useState<Record<string, number>>({}),
    [aiSession, setAiSession] = useState<string>(),
    [mode, setMode] = useState<'split' | 'unified'>('split'),
    [line, setLine] = useState(1),
    [side, setSide] = useState<'LEFT' | 'RIGHT'>('RIGHT'),
    [comment, setComment] = useState(''),
    [comments, setComments] = useState<ReviewComment[]>([]),
    [summary, setSummary] = useState(''),
    [event, setEvent] = useState<'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'>('COMMENT'),
    [error, setError] = useState<string>(),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  const d = resource.data,
    file = d?.files.find((f) => f.filename === selected) ?? d?.files[0],
    self = d?.pull.user?.login.toLowerCase() === d?.viewerLogin.toLowerCase();
  function add() {
    if (!file || !isCommentable(parsePatch(file.patch ?? ''), line, side) || !comment.trim()) {
      setError('invalid_line');
      return;
    }
    setComments([...comments, { path: file.filename, line, side, body: comment.trim() }]);
    setComment('');
    setError(undefined);
    setSaved(false);
  }
  async function save() {
    if (!d) return;
    setBusy(true);
    setError(undefined);
    try {
      await api<DraftDTO>('/api/drafts', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'review',
          repo: owner + '/' + repo,
          prNumber: n,
          payload: {
            headSha: d.pull.head.sha,
            event: self ? 'COMMENT' : event,
            body: summary,
            comments,
            lang: locale,
            aiGenerated: !!aiSession,
            reviewSessionId: aiSession,
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
          <div className="eyebrow">
            <GitPullRequest size={17} />
            {owner + '/' + repo + ' #' + n}
          </div>
          <h1>{d?.pull.title ?? t('reviewTitle')}</h1>
          <p>{t('reviewDescription')}</p>
        </div>
        <Button variant="outline" asChild>
          <a
            href={'https://github.com/' + owner + '/' + repo + '/pull/' + n}
            target="_blank"
            rel="noreferrer"
          >
            {t('openGithub')}
            <ArrowUpRight size={16} />
          </a>
        </Button>
      </div>
      <div className="notice">
        <p>{t('reviewVsMerge')}</p>
        {self && <p>{t('ownPRExplanation')}</p>}
        {d?.pull.draft && <p>{t('draftPRExplanation')}</p>}
      </div>
      <ErrorNotice
        code={error ?? resource.error}
        retry={resource.error ? resource.reload : undefined}
      />
      {resource.loading && <Loading />}
      {d && (
        <>
          <details className="pr-description">
            <summary>{t('overview')}</summary>
            <Markdown body={d.pull.body ?? ''} />
          </details>
          <div className="review-toolbar">
            <span>{t('reviewSha', { sha: d.pull.head.sha.slice(0, 8) })}</span>
            <div className="inline-actions">
              <button className={mode === 'split' ? 'active' : ''} onClick={() => setMode('split')}>
                {t('split')}
              </button>
              <button
                className={mode === 'unified' ? 'active' : ''}
                onClick={() => setMode('unified')}
              >
                {t('unified')}
              </button>
            </div>
          </div>
          {d.truncated && <p className="notice">{t('truncated')}</p>}
          {d.pull.state === 'closed' && <p className="notice">{t('closedPull')}</p>}
          <AIReviewPanel
            repo={owner + '/' + repo}
            prNumber={n}
            headSha={d.pull.head.sha}
            manualComments={comments.filter((c) => !c.findingId)}
            onRisk={setRisk}
            onUse={(incoming, id) => {
              setAiSession(id);
              setComments((current) => [
                ...current.filter((c) => !incoming.some((f) => f.findingId === c.findingId)),
                ...incoming,
              ]);
              setSaved(false);
            }}
          />
          <div className="review-layout">
            <aside className="file-tree">
              <h2>{t('files') + ' · ' + d.files.length}</h2>
              {d.files.map((f) => (
                <button
                  key={f.filename}
                  className={file?.filename === f.filename ? 'selected' : ''}
                  data-risk={risk[f.filename]}
                  onClick={() => {
                    setSelected(f.filename);
                    setLine(1);
                    setSide('RIGHT');
                  }}
                >
                  <FileCode size={15} />
                  <span>{f.filename}</span>
                  <small>{'+' + f.additions + ' −' + f.deletions}</small>
                </button>
              ))}
            </aside>
            <section className="diff-section">
              <header>{file?.filename ?? t('noItems')}</header>
              {file?.patch ? (
                <DiffCanvas
                  file={file}
                  mode={mode}
                  comments={comments}
                  onSelect={(line, side) => {
                    setLine(line);
                    setSide(side);
                    document.getElementById('review-comment')?.focus();
                  }}
                />
              ) : (
                <p className="empty-state">{t('noPatch')}</p>
              )}
            </section>
          </div>
          <div className="review-bottom">
            <section className="comment-composer">
              <h2>{t('addComment')}</h2>
              <p className="muted">{t('selectLine')}</p>
              <div className="coordinate-fields">
                <label className="field-label">
                  {t('line')}
                  <input
                    type="number"
                    min={1}
                    value={line}
                    onChange={(e) => setLine(Number(e.target.value))}
                  />
                </label>
                <label className="field-label">
                  {t('side')}
                  <select
                    aria-label={t('side')}
                    value={side}
                    onChange={(e) => setSide(e.target.value as 'LEFT' | 'RIGHT')}
                  >
                    <option value="LEFT">{t('left')}</option>
                    <option value="RIGHT">{t('right')}</option>
                  </select>
                </label>
              </div>
              <label className="field-label">
                {t('comment')}
                <textarea
                  id="review-comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  maxLength={10000}
                />
              </label>
              <Button variant="outline" onClick={add} disabled={!file?.patch}>
                <Plus size={16} />
                {t('addComment')}
              </Button>
            </section>
            <section className="review-summary">
              <h2>{t('summary')}</h2>
              <label className="field-label">
                <textarea
                  aria-label={t('summary')}
                  value={summary}
                  onChange={(e) => {
                    setSummary(e.target.value);
                    setSaved(false);
                  }}
                  maxLength={60000}
                />
              </label>
              <label className="field-label">
                {t('event')}
                <select
                  aria-label={t('event')}
                  value={self ? 'COMMENT' : event}
                  onChange={(e) => {
                    setEvent(e.target.value as typeof event);
                    setSaved(false);
                  }}
                >
                  {(['COMMENT', 'APPROVE', 'REQUEST_CHANGES'] as const).map((v) => (
                    <option value={v} key={v} disabled={self && v !== 'COMMENT'}>
                      {t(v)}
                    </option>
                  ))}
                </select>
              </label>
              {self && <p className="muted">{t('selfReview')}</p>}
              <div className="inline-actions">
                <Button
                  onClick={save}
                  disabled={
                    busy || saved || (!summary.trim() && !comments.length && event !== 'APPROVE')
                  }
                >
                  {busy ? t('saving') : t('generateReview')}
                </Button>
                {saved && (
                  <Link className="saved-link" href="/drafts">
                    {t('viewDrafts')}
                  </Link>
                )}
              </div>
            </section>
          </div>
          <section className="pending-comments">
            <h2>{t('commentCount', { count: comments.length })}</h2>
            {comments.map((c, index) => (
              <article key={index}>
                <div>
                  <strong>{c.path + ':' + c.line + ' (' + c.side + ')'}</strong>
                  <p>{c.body}</p>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setComments(comments.filter((_, i) => i !== index));
                    setSaved(false);
                  }}
                >
                  {t('remove')}
                </Button>
              </article>
            ))}
          </section>
          <section className="checks-panel">
            <h2>{t('checks')}</h2>
            {d.checksUnavailable ? (
              <p>{t('checksUnavailable')}</p>
            ) : !d.checks.length ? (
              <p>{t('noChecks')}</p>
            ) : (
              d.checks.map((c) => (
                <a href={c.html_url ?? undefined} key={c.id} target="_blank" rel="noreferrer">
                  <span>{c.name}</span>
                  <span>{c.conclusion ?? c.status}</span>
                </a>
              ))
            )}
          </section>
        </>
      )}
    </>
  );
}
