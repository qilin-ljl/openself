import { useEffect, useState } from 'react';
import type { JobDTO, ReviewDTO } from '@openself/shared/ai';
import { api, ApiError } from './api';
export function usePolling<T extends { status: string }>(path: string | null) {
  const [data, setData] = useState<T>(),
    [error, setError] = useState<string>();
  useEffect(() => {
    setData(undefined);
    setError(undefined);
    if (!path) return;
    let active = true;
    const read = () => {
      api<T>(path)
        .then((value) => {
          if (active) {
            setData(value);
            if (['done', 'failed'].includes(value.status)) clearInterval(timer);
          }
        })
        .catch((e) => {
          if (active) {
            setError(e instanceof ApiError ? e.code : 'unknown');
            clearInterval(timer);
          }
        });
    };
    const timer = setInterval(read, 2000);
    read();
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [path]);
  return { data, error };
}
export const useJob = (id: string | undefined) => usePolling<JobDTO>(id ? '/api/jobs/' + id : null);
export const useReview = (id: string | undefined) =>
  usePolling<ReviewDTO>(id ? '/api/reviews/' + id : null);
