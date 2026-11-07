import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { fillIssueInputs } from '../lib/fill-issue';
export default defineContentScript({
  matches: ['https://github.com/*/*/issues/new*'],
  main() {
    browser.runtime.onMessage.addListener((message, sender, reply) => {
      if (
        sender.id !== browser.runtime.id ||
        message?.type !== 'openself.fill' ||
        typeof message.title !== 'string' ||
        typeof message.body !== 'string'
      )
        return;
      let same = false;
      try {
        const expected = new URL(message.url);
        same =
          expected.origin === location.origin &&
          expected.pathname === location.pathname &&
          /^\/[^/]+\/[^/]+\/issues\/new\/?$/.test(location.pathname);
      } catch {
        /* Reject malformed targets. */
      }
      reply({
        ok:
          same &&
          fillIssueInputs(document, {
            title: message.title.slice(0, 200),
            body: message.body.slice(0, 60000),
          }),
      });
    });
  },
});
