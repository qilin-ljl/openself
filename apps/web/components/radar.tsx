'use client';
import { useTranslations } from 'next-intl';
import { useResource, ErrorNotice, Loading } from './data';
import type { RadarItem } from '@openself/core/radar';
export function Radar() {
  const t = useTranslations('ai'),
    r = useResource<{ date: string; items: RadarItem[] }>('/api/radar');
  return (
    <section className="dashboard-section radar-list">
      <h2>{t('radar')}</h2>
      <ErrorNotice code={r.error} retry={r.reload} />
      {r.loading && <Loading />}
      {r.data?.items.map((i) => (
        <a key={i.url} href={i.url} target="_blank" rel="noreferrer">
          <strong>{i.title}</strong>
          <small>
            {i.repo + ' #' + i.number + ' · ' + t('radarReason', { language: i.language })}
          </small>
        </a>
      ))}
      {r.data && !r.data.items.length && <p className="empty-state">{t('radarEmpty')}</p>}
    </section>
  );
}
