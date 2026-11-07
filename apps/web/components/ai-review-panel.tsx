'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@openself/ui/button';
import type { ReviewDTO, FindingDTO } from '@openself/shared/ai';
import type { ReviewComment, z, Viewer } from '@openself/shared/api';
import { api, useResource, ErrorNotice, RequestError } from './data';
export function AIReviewPanel({
  repo,
  prNumber,
  headSha,
  manualComments,
  onUse,
  onRisk,
}: {
  repo: string;
  prNumber: number;
  headSha: string;
  manualComments: ReviewComment[];
  onUse: (comments: ReviewComment[], sessionId: string) => void;
  onRisk: (risk: Record<string, number>) => void;
}) {
  const t = useTranslations('ai'),
    profile = useResource<z.infer<typeof Viewer>>('/api/me');
  const [id, setId] = useState<string>(),
    [playbooks, setPlaybooks] = useState(['security', 'performance', 'readability', 'tests']),
    [error, setError] = useState<string>(),
    [busy, setBusy] = useState(false),
    [reveal, setReveal] = useState(false),
    [learning, setLearning] = useState<boolean>();
  const result = useResource<ReviewDTO>(id ? '/api/reviews/' + id : null, 2000),
    data = result.data;
  const hidden = (learning ?? profile.data?.learningMode ?? false) && !reveal;
  useEffect(() => {
    if (data?.riskMapJson)
      onRisk(Object.fromEntries(data.riskMapJson.files.map((f) => [f.path, f.score])));
  }, [data?.riskMapJson, onRisk]);
  async function start(consented = false) {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<{ reviewSessionId: string }>('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({ repo, prNumber, playbooks }),
      });
      setId(r.reviewSessionId);
      setReveal(false);
    } catch (e) {
      if (
        e instanceof RequestError &&
        e.code === 'private_ai_consent_required' &&
        !consented &&
        window.confirm(t('privateConsent'))
      ) {
        await api('/api/me', { method: 'PATCH', body: JSON.stringify({ privateAiConsent: true }) });
        return start(true);
      }
      setError(e instanceof RequestError ? e.code : 'unknown');
    } finally {
      setBusy(false);
    }
  }
  async function update(f: FindingDTO, status: 'accepted' | 'rejected' | 'edited') {
    let body: string | undefined;
    if (status === 'edited') {
      const value = window.prompt(t('edit'), f.body);
      if (value === null) return;
      body = value;
    }
    try {
      await api('/api/reviews/' + id + '/findings/' + f.id, {
        method: 'PATCH',
        body: JSON.stringify({ status, body }),
      });
      result.reload();
    } catch (e) {
      setError(e instanceof RequestError ? e.code : 'unknown');
    }
  }
  const matched = (f: FindingDTO) =>
    manualComments.some((c) => c.path === f.path && Math.abs(c.line - f.line) <= 3);
  return (
    <section className="ai-panel">
      <div className="ai-heading">
        <h2>{t('title')}</h2>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={learning ?? profile.data?.learningMode ?? false}
            onChange={(e) => {
              setLearning(e.target.checked);
              setReveal(false);
            }}
          />
          {t('learning')}
        </label>
      </div>
      <div className="inline-actions playbooks">
        {['security', 'performance', 'readability', 'tests'].map((p) => (
          <label className="checkbox-label" key={p}>
            <input
              type="checkbox"
              checked={playbooks.includes(p)}
              onChange={(e) =>
                setPlaybooks(
                  e.target.checked ? [...playbooks, p] : playbooks.filter((v) => v !== p),
                )
              }
            />
            {t(p)}
          </label>
        ))}
        <Button
          onClick={() => start()}
          disabled={
            busy ||
            !playbooks.length ||
            (data && ['queued', 'scoring', 'reviewing'].includes(data.status))
          }
        >
          {busy ? t('pending') : t('start')}
        </Button>
      </div>
      <ErrorNotice code={error ?? result.error ?? data?.error ?? undefined} />
      {data && data.headSha !== headSha && <ErrorNotice code="stale_head" />}
      {data && (
        <>
          <p role="status">{t('progress', { progress: data.progress })}</p>
          <progress max={100} value={data.progress} />
          {data.riskMapJson && (
            <p className="muted">
              {t('coverage', {
                count: data.riskMapJson.reviewedFiles,
                skipped: data.riskMapJson.skipped.length,
              })}
              {!data.riskMapJson.rulecardAvailable ? ' ' + t('rulecardMissing') : ''}
            </p>
          )}
          {hidden ? (
            <div className="notice">
              <span>{t('hidden')}</span>
              <Button variant="outline" onClick={() => setReveal(true)}>
                {t('compare')}
              </Button>
            </div>
          ) : (
            <>
              <div className="ai-findings">
                {data.findings.map((f) => (
                  <article key={f.id} className={'finding finding-' + f.severity}>
                    <div className="finding-meta">
                      <strong>{f.path + ':' + f.line + ' · ' + f.severity}</strong>
                      <span>{Math.round(f.confidence * 100) + '%'}</span>
                    </div>
                    <h3>{f.title}</h3>
                    <p>{f.body}</p>
                    {f.suggestion && <pre>{f.suggestion}</pre>}
                    {(learning ?? profile.data?.learningMode) && (
                      <span className="muted">{t(matched(f) ? 'matched' : 'aiOnly')}</span>
                    )}
                    <div className="inline-actions">
                      <Button variant="outline" onClick={() => update(f, 'accepted')}>
                        {t('accept')}
                      </Button>
                      <Button variant="ghost" onClick={() => update(f, 'edited')}>
                        {t('edit')}
                      </Button>
                      <Button variant="ghost" onClick={() => update(f, 'rejected')}>
                        {t('reject')}
                      </Button>
                      <small>
                        {t('status' + f.status.charAt(0).toUpperCase() + f.status.slice(1))}
                      </small>
                    </div>
                  </article>
                ))}
              </div>
              {data.status === 'done' && !data.findings.length && (
                <p className="empty-state">{t('empty')}</p>
              )}
              {reveal && (
                <p className="muted">
                  {t('manualOnly', {
                    count: manualComments.filter(
                      (c) =>
                        !data.findings.some(
                          (f) => f.path === c.path && Math.abs(f.line - c.line) <= 3,
                        ),
                    ).length,
                  })}
                </p>
              )}
              <Button
                variant="outline"
                disabled={
                  !data.findings.some((f) => ['accepted', 'edited'].includes(f.status)) ||
                  data.headSha !== headSha
                }
                onClick={() =>
                  onUse(
                    data.findings
                      .filter((f) => ['accepted', 'edited'].includes(f.status))
                      .map((f) => ({
                        findingId: f.id,
                        path: f.path,
                        line: f.line,
                        side: f.side,
                        startLine: f.startLine,
                        body:
                          f.body +
                          (f.suggestion ? '\n\n```suggestion\n' + f.suggestion + '\n```' : ''),
                      })),
                    id!,
                  )
                }
              >
                {t('apply')}
              </Button>
            </>
          )}
        </>
      )}
    </section>
  );
}
