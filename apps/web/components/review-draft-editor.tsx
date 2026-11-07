'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@openself/ui/button';
import type { DraftDTO, ReviewPayload } from '@openself/shared/api';
import { api, ErrorNotice, RequestError } from './data';
import { Link } from '../i18n/navigation';
export function ReviewDraftEditor({
  draft,
  onSaved,
}: {
  draft: Extract<DraftDTO, { kind: 'review' }>;
  onSaved: () => void;
}) {
  const t = useTranslations('workspace');
  const [payload, setPayload] = useState<ReviewPayload>(draft.payloadJson),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/drafts/' + draft.id, { method: 'PATCH', body: JSON.stringify(payload) });
      onSaved();
    } catch (e) {
      setError(e instanceof RequestError ? e.code : 'unknown');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save}>
      <ErrorNotice code={error} />
      <p className="muted">{t('reviewSha', { sha: payload.headSha.slice(0, 8) })}</p>
      <Link className="text-link" href={'/r/' + draft.repoFullName + '/pull/' + draft.targetNumber}>
        {t('backToPR')}
      </Link>
      <label className="field-label">
        {t('summary')}
        <textarea
          value={payload.body}
          onChange={(e) => setPayload({ ...payload, body: e.target.value })}
        />
      </label>
      <label className="field-label">
        {t('event')}
        <select
          value={payload.event}
          onChange={(e) =>
            setPayload({ ...payload, event: e.target.value as ReviewPayload['event'] })
          }
        >
          {(['COMMENT', 'APPROVE', 'REQUEST_CHANGES'] as const).map((v) => (
            <option key={v} value={v}>
              {t(v)}
            </option>
          ))}
        </select>
      </label>
      {payload.comments.map((c, index) => (
        <label className="field-label" key={index}>
          {c.path + ':' + c.line + ' (' + c.side + ')'}
          <textarea
            value={c.body}
            required
            onChange={(e) =>
              setPayload({
                ...payload,
                comments: payload.comments.map((item, i) =>
                  i === index ? { ...item, body: e.target.value } : item,
                ),
              })
            }
          />
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              setPayload({ ...payload, comments: payload.comments.filter((_, i) => i !== index) })
            }
          >
            {t('remove')}
          </Button>
        </label>
      ))}
      <Button disabled={busy}>{t('save')}</Button>
    </form>
  );
}
