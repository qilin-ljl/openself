import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { APP_URL } from '../lib/api';
export default defineBackground(() => {
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id || message?.type !== 'openself.login') return;
    (async () => {
      const redirectUri = browser.identity.getRedirectURL(),
        state = crypto.randomUUID();
      const url =
        APP_URL +
        '/api/extension/authorize?redirect_uri=' +
        encodeURIComponent(redirectUri) +
        '&state=' +
        encodeURIComponent(state);
      const callback = await browser.identity.launchWebAuthFlow({ url, interactive: true });
      if (!callback) throw new Error('login_cancelled');
      const result = new URL(callback);
      if (
        result.origin !== new URL(redirectUri).origin ||
        result.pathname !== '/' ||
        result.searchParams.get('state') !== state
      )
        throw new Error('invalid_auth_code');
      const code = result.searchParams.get('code');
      if (!code) throw new Error('invalid_auth_code');
      const response = await fetch(APP_URL + '/api/extension/token', {
        method: 'POST',
        credentials: 'omit',
        redirect: 'error',
        headers: { 'X-OpenSelf-Extension': browser.runtime.id, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, redirectUri }),
      });
      if (!response.ok) throw new Error('extension_not_allowed');
      const auth = (await response.json()) as { token: string; expiresAt: string };
      await browser.storage.local.set({ auth });
      return { ok: true };
    })()
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: 'extension_login_failed' }));
    return true;
  });
});
