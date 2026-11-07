import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { currentUser } from '../../../lib/session';
import { Brand } from '../../../components/brand';
import { LanguageSwitch } from '../../../components/language-switch';
import { AccountAction } from '../../../components/account-action';
import { Link } from '../../../i18n/navigation';
export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await currentUser();
  if (!user) redirect(`/${locale}`);
  const t = await getTranslations('common');
  const w = await getTranslations('workspace');
  return (
    <div className="app-shell">
      <header className="site-header">
        <Brand />
        <nav className="app-nav">
          <Link href="/dashboard">{t('dashboard')}</Link>
          <Link href="/search">{w('navSearch')}</Link>
          <Link href="/drafts">{w('navDrafts')}</Link>
          <Link href="/audit">{w('navAudit')}</Link>
          <Link href="/settings">{(await getTranslations('settings'))('title')}</Link>
          <LanguageSwitch />
          <AccountAction action="logout" />
        </nav>
      </header>
      {process.env.NODE_ENV !== 'production' && process.env.E2E_FAKE_AUTH === '1' && (
        <div className="test-banner">{w('testMode')}</div>
      )}
      <main className="app-main">{children}</main>
      <footer className="site-footer">
        <span>{t('brand')}</span>
        <Link href="/privacy">{(await getTranslations('ai'))('privacy')}</Link>
        <span>{t('version')}</span>
      </footer>
    </div>
  );
}
