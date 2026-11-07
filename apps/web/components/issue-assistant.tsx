'use client';
import { useState, useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@openself/ui/button';
import type { IssueDraft, IssueQuality, JobDTO } from '@openself/shared/ai';
import type { FormAnswers } from '@openself/github/templates';
import { api, useResource, ErrorNotice, RequestError } from './data';
import { Markdown } from './markdown';
type DraftResult = IssueDraft & { lang: 'zh' | 'en' };
export function IssueAssistant({
  repo,
  templateId,
  draft,
  onDraft,
  onTranslation,
  allowTranslationApply = true,
}: {
  repo: string;
  templateId?: string;
  draft: { title: string; body: string };
  onDraft: (draft: DraftResult) => void;
  onTranslation: (body: string) => void;
  allowTranslationApply?: boolean;
}) {
  const t = useTranslations('ai'),
    locale = useLocale();
  const [text, setText] = useState(''),
    [answers, setAnswers] = useState<FormAnswers>({}),
    [lang, setLang] = useState<'zh' | 'en' | 'auto'>('auto'),
    [job, setJob] = useState<string>(),
    [error, setError] = useState<string>(),
    [busy, setBusy] = useState(false),
    [generated, setGenerated] = useState<DraftResult>(),
    [quality, setQuality] = useState<IssueQuality>(),
    [translation, setTranslation] = useState<string>(),
    [duplicates, setDuplicates] =
      useState<{ number: number; title: string; url: string; reason: string; verdict: string }[]>();
  const task = useResource<JobDTO>(job ? '/api/jobs/' + job : null, 2000);
  useEffect(() => {
    if (task.data?.status !== 'done') return;
    const value = task.data.resultJson;
    if (task.data.kind === 'issue.draft') setGenerated(value as DraftResult);
    else if (task.data.kind === 'issue.check')
      setDuplicates((value as { candidates: NonNullable<typeof duplicates> }).candidates);
    else if (task.data.kind === 'issue.quality') setQuality(value as IssueQuality);
    else if (task.data.kind === 'translate') setTranslation((value as { text: string }).text);
    setJob(undefined);
  }, [task.data]);
  async function start(kind: 'check' | 'draft' | 'quality' | 'translate', consented = false) {
    setBusy(true);
    setError(undefined);
    try {
      const payload =
        kind === 'quality'
          ? { repo, ...draft, templateId }
          : kind === 'translate'
            ? {
                repo,
                text: draft.body,
                to: lang === 'auto' ? (locale === 'zh' ? 'en' : 'zh') : lang,
              }
            : { repo, text, templateId, answers, lang: lang === 'auto' ? undefined : lang };
      const result = await api<{ jobId: string }>(
        kind === 'translate' ? '/api/translate' : '/api/issues/' + kind,
        { method: 'POST', body: JSON.stringify(payload) },
      );
      setJob(result.jobId);
    } catch (e) {
      if (
        e instanceof RequestError &&
        e.code === 'private_ai_consent_required' &&
        !consented &&
        window.confirm(t('privateConsent'))
      ) {
        await api('/api/me', { method: 'PATCH', body: JSON.stringify({ privateAiConsent: true }) });
        return start(kind, true);
      }
      setError(e instanceof RequestError ? e.code : 'unknown');
    } finally {
      setBusy(false);
    }
  }
  const pending = busy || (!!job && task.data?.status !== 'failed');
  return (
    <section className="ai-panel issue-ai">
      <h2>{t('issueAssistant')}</h2>
      <ErrorNotice code={error ?? task.data?.error ?? undefined} />
      <label className="field-label">
        {t('description')}
        <textarea
          aria-label={t('description')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={20000}
        />
      </label>
      <div className="inline-actions">
        <select
          aria-label={t('translate')}
          value={lang}
          onChange={(e) => setLang(e.target.value as 'zh' | 'en' | 'auto')}
        >
          <option value="auto">{t('repositoryLanguage')}</option>
          <option value="en">{t('english')}</option>
          <option value="zh">{t('chinese')}</option>
        </select>
        <Button variant="outline" disabled={pending || !text.trim()} onClick={() => start('check')}>
          {t('check')}
        </Button>
        <Button disabled={pending || !text.trim()} onClick={() => start('draft')}>
          {t('draft')}
        </Button>
        <Button variant="ghost" disabled={pending || !draft.body} onClick={() => start('quality')}>
          {t('quality')}
        </Button>
        <Button
          variant="ghost"
          disabled={pending || !draft.body}
          onClick={() => start('translate')}
        >
          {t('translate')}
        </Button>
        {pending && <span role="status">{t('pending')}</span>}
      </div>
      {duplicates && (
        <div className="ai-results">
          <h3>{t('duplicates')}</h3>
          {!duplicates.length && <p className="muted">{t('noDuplicates')}</p>}
          {duplicates.map((d) => (
            <article className="duplicate-item" key={d.number}>
              <a href={d.url} target="_blank" rel="noreferrer">
                {'#' + d.number + ' ' + d.title}
              </a>
              <p>{d.reason}</p>
              <Button
                variant="ghost"
                onClick={() => setDuplicates(duplicates.filter((i) => i.number !== d.number))}
              >
                {t('notDuplicate')}
              </Button>
            </article>
          ))}
        </div>
      )}
      {generated && (
        <div className="ai-results">
          <h3>{generated.title}</h3>
          {generated.missingInfo.length > 0 && (
            <>
              <h3>{t('missing')}</h3>
              {generated.missingInfo.map((m) => (
                <label className="field-label" key={m.field}>
                  {m.question}
                  <input
                    value={String(answers[m.field] ?? '')}
                    onChange={(e) => setAnswers({ ...answers, [m.field]: e.target.value })}
                  />
                </label>
              ))}
            </>
          )}
          <Markdown body={generated.body} />
          <Button variant="outline" onClick={() => onDraft(generated)}>
            {t('useDraft')}
          </Button>
        </div>
      )}
      {quality && (
        <div className="ai-results">
          <h3>{t('qualityScore', { score: quality.score })}</h3>
          {quality.checks.map((c, i) => (
            <p className="quality-check" key={i}>
              <strong>{(c.pass ? '✓ ' : '— ') + c.name}</strong>
              {c.tip}
            </p>
          ))}
        </div>
      )}
      {translation && (
        <div className="ai-results">
          <div className="ai-columns">
            <div>
              <h3>{t('source')}</h3>
              <Markdown body={draft.body} />
            </div>
            <div>
              <h3>{t('translated')}</h3>
              <Markdown body={translation} />
            </div>
          </div>
          <Button
            variant="outline"
            disabled={!allowTranslationApply}
            onClick={() => onTranslation(translation)}
          >
            {t('copyTranslation')}
          </Button>
        </div>
      )}
    </section>
  );
}
