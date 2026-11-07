'use client';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@openself/ui/button';
export function AccountAction({ action }: { action: 'logout' | 'revoke' }) {
  const locale = useLocale(),
    t = useTranslations('settings'),
    c = useTranslations('common');
  const [pending, setPending] = useState(false),
    [error, setError] = useState(false);
  async function submit() {
    if (action === 'revoke' && !window.confirm(t('confirmRevoke'))) return;
    setPending(true);
    setError(false);
    try {
      const response = await fetch(`/api/auth/${action}`, { method: 'POST' });
      if (!response.ok) throw new Error();
      window.location.assign(`/${locale}`);
    } catch {
      setError(true);
      setPending(false);
    }
  }
  return (
    <div>
      <Button
        variant={action === 'revoke' ? 'destructive' : 'ghost'}
        disabled={pending}
        onClick={submit}
      >
        {pending ? t('pending') : action === 'revoke' ? t('revoke') : c('logout')}
      </Button>
      {error && (
        <p role="alert" className="request-error">
          {t('error')}
        </p>
      )}
    </div>
  );
}
