import { defineConfig } from 'wxt';
const appUrl = new URL(process.env.WXT_APP_URL ?? 'http://localhost:3000');
if (
  appUrl.protocol !== 'https:' &&
  !(appUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(appUrl.hostname))
)
  throw new Error('WXT_APP_URL must be HTTPS or localhost.');
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'OpenSelf',
    description:
      'Review GitHub pull requests and prepare issues with human-approved AI assistance.',
    version: '0.1.0',
    permissions: ['sidePanel', 'storage', 'identity', 'tabs'],
    host_permissions: ['https://github.com/*', appUrl.origin + '/*'],
    action: { default_title: 'OpenSelf' },
    icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
  },
});
