import type { z } from 'zod';
export interface LLMProvider {
  completeJSON<T>(opts: {
    tier: 'fast' | 'deep';
    system: string;
    user: string;
    schema: z.ZodType<T>;
    maxTokens?: number;
    signal?: AbortSignal;
  }): Promise<{ data: T; usage: { input: number; output: number; cacheHit: number } }>;
}
