'use client';
import { useTranslations } from 'next-intl';
import { Button } from '@openself/ui/button';
export default function ErrorPage({ reset }: { reset: () => void }) {
  const t = useTranslations('error');
  return (
    <div className="error-panel">
      <h1>{t('title')}</h1>
      <p>{t('description')}</p>
      <Button onClick={reset}>{t('retry')}</Button>
    </div>
  );
}
