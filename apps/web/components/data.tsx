'use client';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@openself/ui/button';
export class RequestError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new RequestError(data.error?.code ?? 'unknown');
  return data;
}
export function useResource<T>(url: string | null, poll = 0) {
  const [data, setData] = useState<T>(),
    [error, setError] = useState<string>(),
    [loading, setLoading] = useState(false),
    [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    setData(undefined);
    api<T>(url, { signal: controller.signal })
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e instanceof RequestError ? e.code : 'unknown');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [url, version]);
  useEffect(() => {
    if (!url || !poll) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      api<T>(url, { signal: controller.signal })
        .then((value) => {
          if (controller.signal.aborted) return;
          setData(value);
          setError(undefined);
          setLoading(false);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e instanceof RequestError ? e.code : 'unknown');
        });
    }, poll);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [url, poll]);
  return { data, error, loading, reload };
}
export function ErrorNotice({ code, retry }: { code?: string; retry?: () => void }) {
  const t = useTranslations('workspace');
  if (!code) return null;
  const key = 'errors.' + code;
  return (
    <div className="notice error-notice" role="alert">
      <span>{t(t.has(key) ? key : 'errors.unknown')}</span>
      {retry && (
        <Button variant="outline" onClick={retry}>
          {t('retry')}
        </Button>
      )}
    </div>
  );
}
export function Loading() {
  const t = useTranslations('workspace');
  return (
    <p className="loading-state" role="status">
      {t('loading')}
    </p>
  );
}
export function Pager({
  page,
  more,
  onChange,
}: {
  page: number;
  more: boolean;
  onChange: (page: number) => void;
}) {
  const t = useTranslations('workspace');
  return (
    <div className="pager">
      <Button variant="outline" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        {t('previous')}
      </Button>
      <span>{t('page', { page })}</span>
      <Button variant="outline" disabled={!more || page >= 50} onClick={() => onChange(page + 1)}>
        {t('next')}
      </Button>
    </div>
  );
}
