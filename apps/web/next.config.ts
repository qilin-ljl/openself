import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { config } from 'dotenv';
config({ path: '../../.env', quiet: true });
const nextConfig: NextConfig = {
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
