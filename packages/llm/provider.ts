import type { LLMProvider } from './index';
import OpenAI from 'openai';
import { setTimeout as delay } from 'node:timers/promises';
import { AppError } from '@openself/shared/errors';
export class LLMOutputError extends AppError {
  constructor() {
    super('llm_output_invalid', 502);
  }
}
export function createDeepSeekProvider(options: {
  apiKey: string;
  baseURL: string;
  models: { fast: string; deep: string };
  deepThinking?: boolean;
  fetch?: typeof fetch;
  onUsage?: (usage: { input: number; output: number; cacheHit: number }) => Promise<void>;
}): LLMProvider {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    maxRetries: 0,
    timeout: 120000,
    fetch: options.fetch,
  });
  return {
    async completeJSON(opts) {
      const usage = { input: 0, output: 0, cacheHit: 0 };
      let correction = '';
      for (let outputAttempt = 0; outputAttempt < 2; outputAttempt++) {
        let result: OpenAI.Chat.Completions.ChatCompletion | undefined;
        for (let networkAttempt = 0; networkAttempt < 4; networkAttempt++) {
          try {
            const thinking = opts.tier === 'deep' && options.deepThinking !== false;
            result = await client.chat.completions.create(
              {
                model: options.models[opts.tier],
                messages: [
                  { role: 'system', content: opts.system + '\nReturn json only.' },
                  { role: 'user', content: opts.user + correction },
                ],
                response_format: { type: 'json_object' },
                max_tokens: opts.maxTokens ?? (opts.tier === 'deep' ? 16000 : 4000),
                thinking: { type: thinking ? 'enabled' : 'disabled' },
                ...(thinking ? { reasoning_effort: 'high' } : {}),
              } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
              { signal: opts.signal },
            );
            break;
          } catch (error) {
            const status = error instanceof OpenAI.APIError ? error.status : undefined;
            if (opts.signal?.aborted) throw new AppError('llm_cancelled', 499);
            if (networkAttempt === 3 || (status !== undefined && status !== 429 && status < 500))
              throw new AppError(status === 401 ? 'llm_key_invalid' : 'llm_unavailable', 502);
            await delay(1000 * 2 ** networkAttempt, undefined, { signal: opts.signal });
          }
        }
        if (!result) throw new AppError('llm_unavailable', 502);
        const extra = result.usage as typeof result.usage & { prompt_cache_hit_tokens?: number };
        const current = {
          input: result.usage?.prompt_tokens ?? 0,
          output: result.usage?.completion_tokens ?? 0,
          cacheHit: extra?.prompt_cache_hit_tokens ?? 0,
        };
        usage.input += current.input;
        usage.output += current.output;
        usage.cacheHit += current.cacheHit;
        await options.onUsage?.(current);
        try {
          const content = result.choices[0]?.message.content;
          if (!content?.trim()) throw new Error('empty');
          const parsed = opts.schema.safeParse(JSON.parse(content));
          if (parsed.success) return { data: parsed.data, usage };
          correction =
            '\nThe previous json failed validation. Fix these fields: ' +
            parsed.error.issues
              .slice(0, 5)
              .map((issue) => {
                const bound =
                  issue.code === 'too_big'
                    ? ' maximum=' + String(issue.maximum)
                    : issue.code === 'too_small'
                      ? ' minimum=' + String(issue.minimum)
                      : '';
                return issue.path.join('.') + ' ' + issue.code + bound;
              })
              .join('; ');
        } catch {
          correction =
            '\nThe previous response was empty or invalid json. Return a complete json object matching the example.';
        }
      }
      throw new LLMOutputError();
    },
  };
}
