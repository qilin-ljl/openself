'use client';
import { useState, useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@openself/ui/button';
import { api, useResource, ErrorNotice, RequestError } from './data';
import type { z, Viewer } from '@openself/shared/api';
import type { JobDTO } from '@openself/shared/ai';
type Settings = {
  statistics: {
    date: string;
    reviews: number;
    issues: number;
    published: number;
    tokensIn: number;
    tokensOut: number;
  }[];
  keyLast4: string | null;
  style: { profileMd: string; sourceCount: number };
  usage: {
    id: string;
    date: string;
    kind: string;
    count: number;
    tokensIn: number;
    tokensOut: number;
  }[];
};
export function AISettings() {
  const t = useTranslations('ai'),
    locale = useLocale(),
    r = useResource<Settings>('/api/me/ai'),
    me = useResource<z.infer<typeof Viewer>>('/api/me');
  const [key, setKey] = useState(''),
    [style, setStyle] = useState<string>(),
    [error, setError] = useState<string>(),
    [job, setJob] = useState<string>(),
    [busy, setBusy] = useState(false);
  const task = useResource<JobDTO>(job ? '/api/jobs/' + job : null, 2000);
  useEffect(() => {
    if (task.data?.status === 'done') {
      r.reload();
      setJob(undefined);
      setStyle(undefined);
    }
  }, [task.data?.status, r.reload]);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      r.reload();
      me.reload();
    } catch (e) {
      setError(e instanceof RequestError ? e.code : 'unknown');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="ai-settings">
      <h2>{t('settings')}</h2>
      <ErrorNotice code={error ?? r.error ?? task.data?.error ?? undefined} />
      {r.data && (
        <p className="notice">
          {r.data.keyLast4 ? t('ownKeyActive') : t('keyRequired')}
        </p>
      )}
      <label className="field-label">
        {t('key')}
        <input
          type="password"
          autoComplete="off"
          placeholder={t('keyPlaceholder')}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <small>{t('keyHelp')}</small>
      </label>
      <div className="inline-actions">
        <Button
          disabled={busy || key.length < 10}
          onClick={() =>
            action(async () => {
              await api('/api/me/api-key', { method: 'PUT', body: JSON.stringify({ key }) });
              setKey('');
            })
          }
        >
          {t('save')}
        </Button>
        {r.data?.keyLast4 && (
          <>
            <span>{t('keySaved', { last4: r.data.keyLast4 })}</span>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => action(() => api('/api/me/api-key', { method: 'DELETE' }))}
            >
              {t('removeKey')}
            </Button>
          </>
        )}
      </div>
      <div className="settings-row">
        <div>
          <h3>{t('privateRepos')}</h3>
          <p>{t('privateReposHelp')}</p>
        </div>
        {me.data?.privateRepoEnabled ? (
          <Button
            variant="outline"
            onClick={() =>
              action(() =>
                api('/api/me', {
                  method: 'PATCH',
                  body: JSON.stringify({ privateRepoEnabled: false }),
                }),
              )
            }
          >
            {t('disablePrivate')}
          </Button>
        ) : (
          <Button asChild variant="outline">
            <a href={'/api/auth/github/login?private=1&next=/' + locale + '/settings'}>
              {t('privateRepos')}
            </a>
          </Button>
        )}
      </div>
      <div className="settings-row">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={me.data?.learningMode ?? false}
            onChange={(e) =>
              action(() =>
                api('/api/me', {
                  method: 'PATCH',
                  body: JSON.stringify({ learningMode: e.target.checked }),
                }),
              )
            }
          />
          {t('learning')}
        </label>
        <label className="field-label">
          {t('maxFindings')}
          <select
            value={me.data?.maxFindings ?? 10}
            onChange={(e) =>
              action(() =>
                api('/api/me', {
                  method: 'PATCH',
                  body: JSON.stringify({ maxFindings: Number(e.target.value) }),
                }),
              )
            }
          >
            <option value={10}>{10}</option>
            <option value={20}>{20}</option>
          </select>
        </label>
      </div>
      <label className="field-label">
        {t('style')}
        <textarea
          value={style ?? r.data?.style.profileMd ?? ''}
          placeholder={t('styleDefault')}
          onChange={(e) => setStyle(e.target.value)}
        />
        <small>{t('styleHelp')}</small>
      </label>
      <div className="inline-actions">
        <Button
          disabled={busy}
          onClick={() =>
            action(() =>
              api('/api/me/style-profile', {
                method: 'PUT',
                body: JSON.stringify({ profileMd: style ?? r.data?.style.profileMd ?? '' }),
              }),
            )
          }
        >
          {t('save')}
        </Button>
        <Button
          variant="outline"
          disabled={busy || !!job || !r.data?.keyLast4}
          onClick={() =>
            action(async () => {
              const result = await api<{ jobId: string }>('/api/me/style-profile/rebuild', {
                method: 'POST',
              });
              setJob(result.jobId);
            })
          }
        >
          {job ? t('pending') : t('rebuildStyle')}
        </Button>
      </div>
      <h3 className="usage-heading">{t('statistics')}</h3>
      <div className="usage-table">
        {r.data?.statistics.map((row) => (
          <div key={row.date}>
            <span>
              {row.date +
                ' · ' +
                t('dailySummary', {
                  reviews: row.reviews,
                  issues: row.issues,
                  published: row.published,
                })}
            </span>
            <span>{t('tokens', { input: row.tokensIn, output: row.tokensOut })}</span>
          </div>
        ))}
      </div>
      <h3 className="usage-heading">{t('usage')}</h3>
      <div className="usage-table">
        {r.data?.usage.slice(0, 14).map((u) => (
          <div key={u.id}>
            <span>{u.date + ' · ' + u.kind + ' · ' + u.count}</span>
            <span>{t('tokens', { input: u.tokensIn, output: u.tokensOut })}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
