'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@openself/ui/button';
import type { DraftDTO } from '@openself/shared/api';
import { CodeChanges } from './code-changes';
import { api, ErrorNotice, RequestError } from './data';
export function PullRequestDraftEditor({
  draft,
  onSaved,
}: {
  draft: Extract<DraftDTO, { kind: 'pull_request' }>;
  onSaved: () => void;
}) {
  const w = useTranslations('workspace'),
    t = useTranslations('contribute');
  const [title, setTitle] = useState(draft.payloadJson.title),
    [body, setBody] = useState(draft.payloadJson.body);
  const [asDraft, setAsDraft] = useState(draft.payloadJson.asDraft),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(undefined);
        try {
          await api('/api/drafts/' + draft.id, {
            method: 'PATCH',
            body: JSON.stringify({
              changeJobId: draft.payloadJson.changeJobId,
              title,
              body,
              asDraft,
            }),
          });
          onSaved();
        } catch (e) {
          setError(e instanceof RequestError ? e.code : 'unknown');
        } finally {
          setBusy(false);
        }
      }}
    >
      <ErrorNotice code={error} />
      <CodeChanges files={draft.payloadJson.files} />
      <label className="field-label">
        {w('title')}
        <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <label className="field-label">
        {w('body')}
        <textarea
          value={body}
          maxLength={60000}
          onChange={(e) => setBody(e.target.value)}
          required
        />
      </label>
      <label className="checkbox-label">
        <input type="checkbox" checked={asDraft} onChange={(e) => setAsDraft(e.target.checked)} />
        {t('asDraft')}
      </label>
      <Button type="submit" disabled={busy}>
        {w('save')}
      </Button>
    </form>
  );
}
