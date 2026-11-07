import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { config } from 'dotenv';
config({ path: '../../.env', quiet: true });
const nextConfig: NextConfig = {
  distDir:
    process.env.NODE_ENV !== 'production' && process.env.E2E_FAKE_AUTH === '1'
      ? '.next-e2e'
      : '.next',
  transpilePackages: [
    '@openself/ui',
    '@openself/core',
    '@openself/db',
    '@openself/shared',
    '@openself/i18n',
  ],
  poweredByHeader: false,
  devIndicators: false,
};
export default createNextIntlPlugin('./i18n/request.ts')(nextConfig);
