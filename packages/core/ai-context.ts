import type { Database } from '@openself/db';
import type { Environment } from '@openself/shared/env';
import type { Workspace } from './workspace';
import type { User } from './drafts';
import type { LLMProvider } from '@openself/llm';
import type { Billing } from './ai-billing';
export type AIContext = {
  db: Database;
  env: Environment;
  workspace: Workspace;
  provider?: (
    userId: string,
    billing: Billing,
    onUsage?: (usage: { input: number; output: number; cacheHit: number }) => void,
  ) => Promise<LLMProvider>;
  enqueue?: (id: string, kind: string) => Promise<void>;
};
export type RunContext = Omit<AIContext, 'provider'> & {
  user: User;
  provider: LLMProvider;
  lang: 'zh' | 'en';
  signal?: AbortSignal;
  checkpoint?: Record<string, unknown>;
  onProgress?: (value: Record<string, unknown>) => Promise<void>;
};
