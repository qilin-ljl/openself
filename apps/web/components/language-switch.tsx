'use client';
import { useLocale, useTranslations } from 'next-intl';
import { Languages } from 'lucide-react';
import { Link, usePathname } from '../i18n/navigation';
export function LanguageSwitch() {
  const locale = useLocale();
  const t = useTranslations('common');
  const pathname = usePathname();
  return (
    <Link className="language-switch" href={pathname} locale={locale === 'zh' ? 'en' : 'zh'}>
      <Languages size={16} />
      {t('language')}
    </Link>
  );
}
