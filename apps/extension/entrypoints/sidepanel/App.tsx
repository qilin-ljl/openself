import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { Button } from '@openself/ui/button';
import { GitBranch } from 'lucide-react';
import { parseGitHubUrl, type GitHubTarget } from '@openself/shared/github-url';
import { api, APP_URL } from '../../lib/api';
import { translate } from '../../lib/i18n';
import { ReviewPanel } from './ReviewPanel';
import { IssuePanel } from './IssuePanel';
export default function App() {
  const [me, setMe] = useState<{ login: string; locale: 'zh' | 'en' }>(),
    [locale, setLocale] = useState<'zh' | 'en'>('zh'),
    [target, setTarget] = useState<GitHubTarget | null>(null),
    [tabId, setTabId] = useState<number>(),
    [url, setUrl] = useState(''),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  const targetKey = useRef('');
  const t = (key: string, v?: Record<string, string | number>) => translate(locale, key, v);
  const loadMe = useCallback(async () => {
    try {
      const user = await api<{ login: string; locale: 'zh' | 'en' }>('/api/me');
      setMe(user);
      setLocale(user.locale);
    } catch {
      setMe(undefined);
    } finally {
      setReady(true);
    }
  }, []);
  useEffect(() => {
    void loadMe();
    const update = async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      setTabId(tab?.id);
      setUrl(tab?.url ?? '');
      const next = parseGitHubUrl(tab?.url ?? '');
      const key = JSON.stringify(next);
      if (key !== targetKey.current) {
        targetKey.current = key;
        setTarget(next);
      }
    };
    void update();
    const updated = (_id: number, info: { url?: string }) => {
      if (info.url) void update();
    };
    const activated = () => void update();
    const changed = (changes: Record<string, unknown>) => {
      if (changes.auth) void loadMe();
    };
    browser.tabs.onActivated.addListener(activated);
    browser.tabs.onUpdated.addListener(updated);
    browser.storage.onChanged.addListener(changed);
    return () => {
      browser.tabs.onActivated.removeListener(activated);
      browser.tabs.onUpdated.removeListener(updated);
      browser.storage.onChanged.removeListener(changed);
    };
  }, [loadMe]);
  async function login() {
    setBusy(true);
    setError(false);
    try {
      const result = (await browser.runtime.sendMessage({ type: 'openself.login' })) as {
        ok: boolean;
      };
      if (!result.ok) throw new Error();
      await loadMe();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      await api('/api/extension/logout', { method: 'POST' });
    } finally {
      await browser.storage.local.remove('auth');
      setMe(undefined);
    }
  }
  return (
    <main>
      <header>
        <div className="brand">
          <GitBranch size={22} />
          <strong>{t('common.brand')}</strong>
        </div>
        <button
          className="language"
          onClick={() => {
            const next = locale === 'zh' ? 'en' : 'zh';
            setLocale(next);
            if (me)
              void api('/api/me', { method: 'PATCH', body: JSON.stringify({ locale: next }) });
          }}
        >
          {t('common.language')}
        </button>
      </header>
      {!ready ? (
        <section>
          <p role="status">{t('ai.pending')}</p>
        </section>
      ) : !me ? (
        <section>
          <p>{t('extension.loginHelp')}</p>
          <code>{browser.runtime.id}</code>
          <Button disabled={busy} onClick={login}>
            {t('extension.connect')}
          </Button>
          {error && <p className="error">{t('extension.failed')}</p>}
        </section>
      ) : (
        <>
          <div className="account">
            <span>{t('extension.connected', { login: me.login })}</span>
            <button onClick={logout}>{t('common.logout')}</button>
          </div>
          {target && tabId ? (
            target.kind === 'pr' ? (
              <ReviewPanel key={targetKey.current} target={target} tabId={tabId} locale={locale} />
            ) : target.kind === 'issue' ? (
              <IssuePanel
                key={targetKey.current}
                target={target}
                tabId={tabId}
                url={url}
                locale={locale}
              />
            ) : (
              <section>
                <h2>{target.owner + '/' + target.repo}</h2>
                <Button asChild>
                  <a
                    href={APP_URL + '/' + locale + '/r/' + target.owner + '/' + target.repo}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('extension.openWeb')}
                  </a>
                </Button>
              </section>
            )
          ) : (
            <section>
              <p>{t('extension.empty')}</p>
            </section>
          )}
          <footer>
            <a href={APP_URL + '/' + locale + '/settings'} target="_blank" rel="noreferrer">
              {t('extension.settings')}
            </a>
            <a href={APP_URL + '/' + locale + '/privacy'} target="_blank" rel="noreferrer">
              {t('ai.privacy')}
            </a>
          </footer>
        </>
      )}
    </main>
  );
}
