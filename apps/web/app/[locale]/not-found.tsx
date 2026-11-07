import { getTranslations } from 'next-intl/server';
import { Link } from '../../i18n/navigation';
export default async function NotFound() {
  const t = await getTranslations('notFound'),
    c = await getTranslations('common');
  return (
    <div className="error-panel">
      <h1>{t('title')}</h1>
      <p>{t('description')}</p>
      <Link href="/">{c('back')}</Link>
    </div>
  );
}
