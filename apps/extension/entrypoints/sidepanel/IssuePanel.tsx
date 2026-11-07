import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { Button } from '@openself/ui/button';
import type { GitHubTarget } from '@openself/shared/github-url';
import type { IssueDraft, IssueQuality } from '@openself/shared/ai';
import { api, ApiError, APP_URL } from '../../lib/api';
import { useJob } from '../../lib/hooks';
import { translate } from '../../lib/i18n';
export function IssuePanel({
  target,
  tabId,
  url,
  locale,
}: {
  target: GitHubTarget;
  tabId: number;
  url: string;
  locale: 'zh' | 'en';
}) {
  const t = (key: string, v?: Record<string, string | number>) => translate(locale, key, v),
    repo = target.owner + '/' + target.repo;
  const [text, setText] = useState(''),
    [templates, setTemplates] = useState<{ id: string; name: string; kind: string }[]>([]),
    [template, setTemplate] = useState(''),
    [blank, setBlank] = useState(true),
    [job, setJob] = useState<string>(),
    [draft, setDraft] = useState<IssueDraft & { lang?: string }>(),
    [answers, setAnswers] = useState<Record<string, string>>({}),
    [quality, setQuality] = useState<IssueQuality>(),
    [duplicates, setDuplicates] =
      useState<{ number: number; title: string; url: string; reason: string }[]>(),
    [error, setError] = useState<string>(),
    [notice, setNotice] = useState<string>(),
    [busy, setBusy] = useState(false);
  const task = useJob(job),
    isForm = templates.find((x) => x.id === template)?.kind === 'form';
  useEffect(() => {
    api<{ templates: typeof templates; blankIssuesEnabled: boolean }>(
      '/api/repos/' + repo + '/issue-templates',
    )
      .then((r) => {
        setTemplates(r.templates);
        setBlank(r.blankIssuesEnabled);
        const hint = new URL(url).searchParams.get('template');
        setTemplate(
          r.templates.find((x) => x.id === hint)?.id ??
            (r.blankIssuesEnabled ? '' : (r.templates[0]?.id ?? '')),
        );
      })
      .catch((e) => setError(e instanceof ApiError ? e.code : 'unknown'));
  }, [repo, url]);
  useEffect(() => {
    if (task.data?.status === 'done') {
      const value = task.data.resultJson;
      if (task.data.kind === 'issue.draft') setDraft(value as IssueDraft);
      else if (task.data.kind === 'issue.quality') setQuality(value as IssueQuality);
      else if (task.data.kind === 'issue.check')
        setDuplicates((value as { candidates: NonNullable<typeof duplicates> }).candidates);
      setJob(undefined);
    }
  }, [task.data]);
  async function run(kind: 'check' | 'draft' | 'quality', consent = false) {
    setBusy(true);
    setError(undefined);
    try {
      const input =
        kind === 'quality'
          ? { repo, title: draft?.title, body: draft?.body, templateId: template || undefined }
          : { repo, text, templateId: template || undefined, answers };
      const result = await api<{ jobId: string }>('/api/issues/' + kind, {
        method: 'POST',
        body: JSON.stringify(input),
      });
      setJob(result.jobId);
    } catch (e) {
      if (
        e instanceof ApiError &&
        e.code === 'private_ai_consent_required' &&
        !consent &&
        window.confirm(t('ai.privateConsent'))
      ) {
        await api('/api/me', { method: 'PATCH', body: JSON.stringify({ privateAiConsent: true }) });
        return run(kind, true);
      }
      setError(e instanceof ApiError ? e.code : 'unknown');
    } finally {
      setBusy(false);
    }
  }
  async function fill() {
    if (!draft) return;
    try {
      const result = (await browser.tabs.sendMessage(tabId, {
        type: 'openself.fill',
        url,
        title: draft.title,
        body: draft.body,
      })) as { ok: boolean };
      if (result.ok) {
        setNotice('filled');
        return;
      }
    } catch {
      /* Unsupported GitHub editors use the clipboard. */
    }
    try {
      await navigator.clipboard.writeText(draft.title + '\n\n' + draft.body);
      setNotice('copied');
    } catch {
      setNotice('copyFailed');
    }
  }
  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      await api('/api/drafts', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'issue',
          repo,
          payload: {
            title: draft.title,
            body: draft.body,
            templateId: template || undefined,
            answers: draft.fields ?? {},
            lang: draft.lang ?? 'en',
            aiGenerated: true,
          },
        }),
      });
      setNotice('saved');
    } catch (e) {
      setError(e instanceof ApiError ? e.code : 'unknown');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2>{repo}</h2>
      <label>
        {t('ai.description')}
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={20000} />
      </label>
      <label>
        {t('workspace.template')}
        <select value={template} onChange={(e) => setTemplate(e.target.value)}>
          {blank && <option value="">{t('workspace.blank')}</option>}
          {templates.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        <Button
          variant="outline"
          disabled={busy || !!job || !text.trim()}
          onClick={() => run('check')}
        >
          {t('ai.check')}
        </Button>
        <Button disabled={busy || !!job || !text.trim()} onClick={() => run('draft')}>
          {t('ai.draft')}
        </Button>
      </div>
      {job && <p>{t('ai.pending')}</p>}
      {(error ?? task.data?.error) && (
        <p className="error">{t('workspace.errors.' + (error ?? task.data?.error))}</p>
      )}
      {duplicates && (
        <div>
          {duplicates.map((d) => (
            <article key={d.number}>
              <a href={d.url} target="_blank" rel="noreferrer">
                {'#' + d.number + ' ' + d.title}
              </a>
              <p>{d.reason}</p>
              <Button
                variant="ghost"
                onClick={() => setDuplicates(duplicates.filter((v) => v.number !== d.number))}
              >
                {t('ai.notDuplicate')}
              </Button>
            </article>
          ))}
          {!duplicates.length && <p>{t('ai.noDuplicates')}</p>}
        </div>
      )}
      {draft && (
        <>
          {draft.missingInfo.map((m) => (
            <label key={m.field}>
              {m.question}
              <input
                value={answers[m.field] ?? ''}
                onChange={(e) => setAnswers({ ...answers, [m.field]: e.target.value })}
              />
            </label>
          ))}
          <label>
            {t('extension.title')}
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label>
            {t('extension.body')}
            <textarea
              value={draft.body}
              readOnly={isForm}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
          </label>
          {isForm && <p>{t('extension.formNote')}</p>}
          <div className="actions">
            <Button disabled={busy} onClick={fill}>
              {t('extension.fill')}
            </Button>
            <Button variant="outline" disabled={busy} onClick={save}>
              {t('workspace.save')}
            </Button>
            <Button variant="ghost" disabled={busy || !!job} onClick={() => run('quality')}>
              {t('ai.quality')}
            </Button>
          </div>
        </>
      )}
      {quality && (
        <div>
          <h3>{t('ai.qualityScore', { score: quality.score })}</h3>
          {quality.checks.map((c, i) => (
            <p key={i}>{c.name + ': ' + c.tip}</p>
          ))}
        </div>
      )}
      {notice && <p role="status">{t('extension.' + notice)}</p>}
      <a
        href={APP_URL + '/' + locale + '/r/' + repo + '/issues/new'}
        target="_blank"
        rel="noreferrer"
      >
        {t('extension.openWeb')}
      </a>
    </section>
  );
}
