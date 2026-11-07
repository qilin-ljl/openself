'use client';
import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Button } from '@openself/ui/button';
import type { z, Viewer } from '@openself/shared/api';
import { api, useResource, ErrorNotice, RequestError, Loading } from './data';
type Profile = z.infer<typeof Viewer>;
export function Preferences() {
  const t = useTranslations('workspace'),
    locale = useLocale(),
    r = useResource<Profile>('/api/me');
  const [disclosure, setDisclosure] = useState<boolean>(),
    [language, setLanguage] = useState(locale),
    [error, setError] = useState<string>(),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api('/api/me', {
        method: 'PATCH',
        body: JSON.stringify({
          locale: language,
          aiDisclosure: disclosure ?? r.data?.aiDisclosure ?? true,
        }),
      });
      setSaved(true);
      if (language !== locale) window.location.assign('/' + language + '/settings');
    } catch (e) {
      setError(e instanceof RequestError ? e.code : 'unknown');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <ErrorNotice code={error ?? r.error} />
      {r.loading && <Loading />}
      {r.data && (
        <form onSubmit={save}>
          <div className="settings-row">
            <label className="field-label">
              {t('language')}
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="zh">{t('chinese')}</option>
                <option value="en">{t('english')}</option>
              </select>
            </label>
          </div>
          <div className="settings-row">
            <div>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={disclosure ?? r.data.aiDisclosure}
                  onChange={(e) => setDisclosure(e.target.checked)}
                />
                {t('aiDisclosure')}
              </label>
              <p>{t('aiDisclosureHelp')}</p>
            </div>
          </div>
          <div className="inline-actions">
            <Button disabled={busy}>{t('save')}</Button>
            {saved && <span role="status">{t('preferencesSaved')}</span>}
          </div>
        </form>
      )}
    </>
  );
}
