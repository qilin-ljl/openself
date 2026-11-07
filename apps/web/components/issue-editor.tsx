'use client';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@openself/ui/button';
import type { GitHubClient } from '@openself/github';
import type { FormAnswers } from '@openself/github/templates';
import { buildFormBody } from '@openself/github/templates';
import type { DraftDTO, IssuePayload } from '@openself/shared/api';
import { Link } from '../i18n/navigation';
import { api, ErrorNotice, Loading, RequestError, useResource } from './data';
import { Markdown } from './markdown';
import { IssueAssistant } from './issue-assistant';
export function IssueEditor({
  repoFullName,
  initial,
  onSaved,
  scanJobId,
  findingId,
}: {
  repoFullName: string;
  initial?: DraftDTO;
  onSaved?: () => void;
  scanJobId?: string;
  findingId?: string;
}) {
  const t = useTranslations('workspace'),
    locale = useLocale();
  const original = initial?.payloadJson as IssuePayload | undefined;
  const context = useResource<{ repo: string; title: string; description: string }>(
    scanJobId && findingId
      ? '/api/scans/' + encodeURIComponent(scanJobId) + '/findings/' + encodeURIComponent(findingId)
      : null,
  );
  const resource = useResource<Awaited<ReturnType<GitHubClient['listIssueTemplates']>>>(
    '/api/repos/' + repoFullName + '/issue-templates',
  );
  const [selected, setSelected] = useState(original?.templateId ?? ''),
    [aiGenerated, setAiGenerated] = useState(original?.aiGenerated ?? false),
    [outputLang, setOutputLang] = useState<'zh' | 'en'>(
      original?.lang ?? (locale === 'zh' ? 'zh' : 'en'),
    ),
    [title, setTitle] = useState(original?.title ?? ''),
    [body, setBody] = useState(original?.body ?? ''),
    [answers, setAnswers] = useState<FormAnswers>(original?.answers ?? {}),
    [preview, setPreview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [savedId, setSavedId] = useState(initial?.id);
  useEffect(() => {
    if (!resource.data || initial) return;
    if (!resource.data.blankIssuesEnabled && resource.data.templates[0]) {
      const template = resource.data.templates[0];
      setSelected(template.id);
      setTitle(template.title ?? '');
      setBody(template.body ?? '');
    }
  }, [resource.data, initial]);
  const template = resource.data?.templates.find((item) => item.id === selected);
  function choose(id: string) {
    const template = resource.data?.templates.find((item) => item.id === id);
    setSelected(id);
    setTitle(template?.title ?? '');
    setBody(template?.body ?? '');
    setAnswers({});
    setSavedId(initial?.id);
  }
  let previewBody = body;
  if (template?.kind === 'form') {
    try {
      previewBody = buildFormBody(template, answers);
    } catch {
      previewBody = t('errors.required_fields');
    }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const payload: IssuePayload = {
        title,
        body: previewBody,
        answers,
        templateId: selected || undefined,
        lang: outputLang,
        aiGenerated,
      };
      const result = await api<DraftDTO>(savedId ? '/api/drafts/' + savedId : '/api/drafts', {
        method: savedId ? 'PATCH' : 'POST',
        body: JSON.stringify(savedId ? payload : { kind: 'issue', repo: repoFullName, payload }),
      });
      setSavedId(result.id);
      onSaved?.();
    } catch (e) {
      setError(e instanceof RequestError ? e.code : 'validation');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <ErrorNotice code={context.error} retry={context.reload} />
      <IssueAssistant
        initialDescription={
          context.data?.repo === repoFullName.toLowerCase() ? context.data.description : undefined
        }
        allowTranslationApply={template?.kind !== 'form'}
        repo={repoFullName}
        templateId={selected || undefined}
        draft={{ title, body: previewBody }}
        onDraft={(value) => {
          setTitle(value.title);
          setBody(value.body);
          setAnswers(value.fields ?? {});
          setOutputLang(value.lang);
          setAiGenerated(true);
        }}
        onTranslation={(value) => {
          setBody(value);
          setAiGenerated(true);
        }}
      />
      <ErrorNotice
        code={resource.error ?? error}
        retry={resource.error ? resource.reload : undefined}
      />
      {resource.loading ? (
        <Loading />
      ) : (
        resource.data && (
          <form onSubmit={save} className="issue-editor">
            {resource.data.warnings.length > 0 && <p className="notice">{t('templateWarning')}</p>}
            <div className="editor-toolbar">
              <label>
                {t('template')}
                <select value={selected} onChange={(e) => choose(e.target.value)}>
                  {resource.data.blankIssuesEnabled && <option value="">{t('blank')}</option>}
                  {resource.data.templates.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="tabs">
                <button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>
                  {t('edit')}
                </button>
                <button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>
                  {t('preview')}
                </button>
              </div>
            </div>
            <label className="field-label">
              {t('title')}
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={200}
              />
            </label>
            {preview ? (
              <div className="preview-panel">
                <Markdown body={previewBody} />
              </div>
            ) : template?.kind === 'form' ? (
              <div className="form-fields">
                {template.fields?.map((field) =>
                  field.type === 'markdown' ? (
                    <Markdown key={field.id} body={field.value ?? ''} />
                  ) : (
                    <div className="field-label" key={field.id}>
                      <label htmlFor={'form-' + field.id}>
                        {field.label}
                        {field.required && <span className="required-tag">{t('required')}</span>}
                      </label>
                      {field.description && <p>{field.description}</p>}
                      {field.type === 'checkboxes' ? (
                        <div className="checkboxes">
                          {field.options.map((option) => (
                            <label key={option.label}>
                              <input
                                type="checkbox"
                                required={option.required}
                                checked={
                                  Array.isArray(answers[field.id]) &&
                                  (answers[field.id] as string[]).includes(option.label)
                                }
                                onChange={(e) => {
                                  const current = Array.isArray(answers[field.id])
                                    ? (answers[field.id] as string[])
                                    : [];
                                  setAnswers({
                                    ...answers,
                                    [field.id]: e.target.checked
                                      ? [...current, option.label]
                                      : current.filter((v) => v !== option.label),
                                  });
                                }}
                              />
                              {option.label}
                            </label>
                          ))}
                        </div>
                      ) : field.type === 'dropdown' ? (
                        <select
                          id={'form-' + field.id}
                          required={field.required}
                          multiple={field.multiple}
                          value={answers[field.id] ?? (field.multiple ? [] : '')}
                          onChange={(e) =>
                            setAnswers({
                              ...answers,
                              [field.id]: field.multiple
                                ? Array.from(e.target.selectedOptions).map((o) => o.value)
                                : e.target.value,
                            })
                          }
                        >
                          {!field.multiple && <option value="">{t('choose')}</option>}
                          {field.options.map((o) => (
                            <option key={o.label} value={o.label}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : field.type === 'textarea' ? (
                        <textarea
                          id={'form-' + field.id}
                          required={field.required}
                          value={String(answers[field.id] ?? field.value ?? '')}
                          placeholder={field.placeholder}
                          onChange={(e) => setAnswers({ ...answers, [field.id]: e.target.value })}
                        />
                      ) : (
                        <input
                          id={'form-' + field.id}
                          required={field.required}
                          value={String(answers[field.id] ?? field.value ?? '')}
                          placeholder={field.placeholder}
                          onChange={(e) => setAnswers({ ...answers, [field.id]: e.target.value })}
                        />
                      )}
                    </div>
                  ),
                )}
              </div>
            ) : (
              <label className="field-label">
                {t('body')}
                <textarea
                  className="body-editor"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  maxLength={60000}
                />
              </label>
            )}
            <div className="editor-footer">
              <Button
                type="submit"
                disabled={busy || (!selected && !resource.data.blankIssuesEnabled)}
              >
                {busy ? t('saving') : t('save')}
              </Button>
              {savedId && (
                <Link href="/drafts" className="saved-link">
                  {t('saved') + ' · ' + t('viewDrafts')}
                </Link>
              )}
            </div>
          </form>
        )
      )}
    </>
  );
}
