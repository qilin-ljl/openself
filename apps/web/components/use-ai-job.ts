'use client';
import { useEffect, useState } from 'react';
import type { JobDTO } from '@openself/shared/ai';
import { useResource } from './data';
export function useAIJob(jobId?: string) {
  const [finished, setFinished] = useState<string>();
  const task = useResource<JobDTO>(
    jobId ? '/api/jobs/' + encodeURIComponent(jobId) : null,
    jobId && finished !== jobId ? 2000 : 0,
  );
  useEffect(() => {
    if (jobId && task.data?.id === jobId && task.data.status === 'done') setFinished(jobId);
  }, [jobId, task.data]);
  return task;
}
