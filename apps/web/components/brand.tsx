import { GitBranch } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '../i18n/navigation';
export async function Brand() {
  const t = await getTranslations('common');
  return (
    <Link href="/" className="brand">
      <span className="brand-mark">
        <GitBranch size={23} />
      </span>
      {t('brand')}
    </Link>
  );
}
