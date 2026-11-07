import { useState, useEffect } from 'react';
import { browser } from 'wxt/browser';
import { Button } from '@openself/ui/button';
import type { GitHubTarget } from '@openself/shared/github-url';
import { githubLineUrl } from '@openself/shared/github-url';
import type { FindingDTO } from '@openself/shared/ai';
import { api, APP_URL, ApiError } from '../../lib/api';
import { useReview } from '../../lib/hooks';
import { translate } from '../../lib/i18n';
export function ReviewPanel({
  target,
  tabId,
  locale,
}: {
  target: GitHubTarget;
  tabId: number;
  locale: 'zh' | 'en';
}) {
  const t = (key: string, values?: Record<string, string | number>) =>
      translate(locale, key, values),
    repo = target.owner + '/' + target.repo;
  const [id, setId] = useState<string>(),
    [summary, setSummary] = useState(''),
    [event, setEvent] = useState('COMMENT'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [saved, setSaved] = useState(false),
    [self, setSelf] = useState(false),
    [playbooks, setPlaybooks] = useState(['security', 'performance', 'readability', 'tests']),
    [learning, setLearning] = useState(false),
    [revealed, setRevealed] = useState(false);
  const r = useReview(id);
  useEffect(() => {
    api<{ pull: { user: { login: string } | null }; viewerLogin: string }>(
      '/api/repos/' + repo + '/pulls/' + target.number,
    )
      .then((p) => setSelf(p.pull.user?.login === p.viewerLogin))
      .catch(() => {});
  }, [repo, target.number]);
  useEffect(() => {
    api<{ learningMode: boolean }>('/api/me')
      .then((u) => setLearning(u.learningMode))
      .catch(() => {});
  }, []);
  async function start(consent = false) {
    setBusy(true);
    setError(undefined);
    try {
      const result = await api<{ reviewSessionId: string }>('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({ repo, prNumber: target.number, playbooks }),
      });
      setId(result.reviewSessionId);
      setRevealed(false);
      setSaved(false);
    } catch (e) {
      if (
        e instanceof ApiError &&
        e.code === 'private_ai_consent_required' &&
        !consent &&
        window.confirm(t('ai.privateConsent'))
      ) {
        await api('/api/me', { method: 'PATCH', body: JSON.stringify({ privateAiConsent: true }) });
        return start(true);
      }
      setError(e instanceof ApiError ? e.code : 'unknown');
    } finally {
      setBusy(false);
    }
  }
  async function edit(f: FindingDTO, status: 'accepted' | 'rejected' | 'edited') {
    const body = status === 'edited' ? window.prompt(t('ai.edit'), f.body) : undefined;
    if (body === null) return;
    try {
      await api('/api/reviews/' + id + '/findings/' + f.id, {
        method: 'PATCH',
        body: JSON.stringify({ status, body }),
      });
      if (r.data) {
        r.data.findings = r.data.findings.map((item) =>
          item.id === f.id ? { ...item, status, body: body ?? item.body } : item,
        );
        setSaved(false);
        setRevision((v) => v + 1);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.code : 'unknown');
    }
  }
  const [, setRevision] = useState(0);
  async function save() {
    if (!r.data) return;
    setBusy(true);
    try {
      await api('/api/drafts', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'review',
          repo,
          prNumber: target.number,
          payload: {
            reviewSessionId: id,
            headSha: r.data.headSha,
            event: self ? 'COMMENT' : event,
            body: summary,
            lang: locale,
            aiGenerated: true,
            comments: r.data.findings
              .filter((f) => ['accepted', 'edited'].includes(f.status))
              .map((f) => ({
                findingId: f.id,
                path: f.path,
                line: f.line,
                side: f.side,
                startLine: f.startLine,
                body: f.body + (f.suggestion ? '\n\n```suggestion\n' + f.suggestion + '\n```' : ''),
              })),
          },
        }),
      });
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.code : 'unknown');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2>{repo + ' #' + target.number}</h2>
      <div className="playbooks">
        {['security', 'performance', 'readability', 'tests'].map((p) => (
          <label key={p}>
            <input
              type="checkbox"
              checked={playbooks.includes(p)}
              onChange={(e) =>
                setPlaybooks(
                  e.target.checked ? [...playbooks, p] : playbooks.filter((v) => v !== p),
                )
              }
            />
            {t('ai.' + p)}
          </label>
        ))}
      </div>
      <Button
        disabled={
          busy ||
          !playbooks.length ||
          (!!r.data && ['queued', 'scoring', 'reviewing'].includes(r.data.status))
        }
        onClick={() => start()}
      >
        {busy ? t('ai.pending') : t('ai.start')}
      </Button>
      {(error ?? r.error ?? r.data?.error) && (
        <p className="error">{t('workspace.errors.' + (error ?? r.error ?? r.data?.error))}</p>
      )}
      {r.data && (
        <>
          <p>{t('ai.progress', { progress: r.data.progress })}</p>
          <progress max={100} value={r.data.progress} />
          {r.data.riskMapJson && (
            <>
              <p>
                {t('ai.coverage', {
                  count: r.data.riskMapJson.reviewedFiles,
                  skipped: r.data.riskMapJson.skipped.length,
                })}
              </p>
              <div className="risk-list">
                {r.data.riskMapJson.files.map((f) => (
                  <span key={f.path}>{f.path + ' · ' + f.score + '/5'}</span>
                ))}
              </div>
            </>
          )}
          {learning && !revealed ? (
            <div>
              <p>{t('ai.hidden')}</p>
              <Button variant="outline" onClick={() => setRevealed(true)}>
                {t('ai.compare')}
              </Button>
            </div>
          ) : (
            r.data.findings.map((f) => (
              <article className="finding" key={f.id}>
                <button
                  className="path-link"
                  onClick={async () =>
                    browser.tabs.update(tabId, {
                      url: await githubLineUrl(
                        target.owner,
                        target.repo,
                        target.number!,
                        f.path,
                        f.line,
                        f.side,
                      ),
                    })
                  }
                >
                  {f.path + ':' + f.line}
                </button>
                <strong>{f.title}</strong>
                <p>{f.body}</p>
                <div className="actions">
                  <Button variant="outline" onClick={() => edit(f, 'accepted')}>
                    {t('ai.accept')}
                  </Button>
                  <Button variant="ghost" onClick={() => edit(f, 'edited')}>
                    {t('ai.edit')}
                  </Button>
                  <Button variant="ghost" onClick={() => edit(f, 'rejected')}>
                    {t('ai.reject')}
                  </Button>
                </div>
                <small>
                  {t('ai.status' + f.status.charAt(0).toUpperCase() + f.status.slice(1))}
                </small>
              </article>
            ))
          )}
          <label>
            {t('extension.summary')}
            <textarea
              value={summary}
              onChange={(e) => {
                setSummary(e.target.value);
                setSaved(false);
              }}
            />
          </label>
          <label>
            {t('workspace.event')}
            <select value={self ? 'COMMENT' : event} onChange={(e) => setEvent(e.target.value)}>
              {['COMMENT', 'APPROVE', 'REQUEST_CHANGES'].map((v) => (
                <option value={v} key={v} disabled={self && v !== 'COMMENT'}>
                  {t('workspace.' + v)}
                </option>
              ))}
            </select>
          </label>
          <Button
            disabled={
              busy ||
              saved ||
              (!summary && !r.data.findings.some((f) => ['accepted', 'edited'].includes(f.status)))
            }
            onClick={save}
          >
            {t('workspace.save')}
          </Button>
          {saved && <p role="status">{t('extension.saved')}</p>}
        </>
      )}
      <a
        href={APP_URL + '/' + locale + '/r/' + repo + '/pull/' + target.number}
        target="_blank"
        rel="noreferrer"
      >
        {t('extension.openWeb')}
      </a>
    </section>
  );
}
