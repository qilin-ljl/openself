import { beforeAll, afterAll, afterEach, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { z } from 'zod';
import { createDeepSeekProvider } from './provider';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
const provider = () =>
  createDeepSeekProvider({
    apiKey: 'test-only',
    baseURL: 'https://api.deepseek.com',
    models: { fast: 'test-fast', deep: 'test-deep' },
  });
const response = (content: string) =>
  HttpResponse.json({
    id: 'test',
    object: 'chat.completion',
    created: 1,
    model: 'test',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5, prompt_cache_hit_tokens: 3 },
  });
it('selects a configurable model, enables deep thinking and returns validated data/usage', async () => {
  let sent: Record<string, unknown> = {};
  server.use(
    http.post('https://api.deepseek.com/chat/completions', async ({ request }) => {
      sent = (await request.json()) as Record<string, unknown>;
      return response('{"ok":true}');
    }),
  );
  const result = await provider().completeJSON({
    tier: 'deep',
    system: 'Return json: {"ok":true}',
    user: 'Test',
    schema: z.object({ ok: z.boolean() }),
  });
  expect(result).toEqual({ data: { ok: true }, usage: { input: 10, output: 5, cacheHit: 3 } });
  expect(sent).toMatchObject({
    model: 'test-deep',
    thinking: { type: 'enabled' },
    reasoning_effort: 'high',
    response_format: { type: 'json_object' },
  });
  expect(sent.tools).toBeUndefined();
});
it('retries invalid output once and includes all billable usage', async () => {
  let calls = 0;
  server.use(
    http.post('https://api.deepseek.com/chat/completions', () =>
      response(++calls === 1 ? 'not json' : '{"ok":true}'),
    ),
  );
  const result = await provider().completeJSON({
    tier: 'fast',
    system: 'Return json {"ok":true}',
    user: 'Test',
    schema: z.object({ ok: z.boolean() }),
  });
  expect(result.usage.input).toBe(20);
  expect(result.data.ok).toBe(true);
  expect(calls).toBe(2);
});
it('rejects an invalid schema twice without exposing generated content', async () => {
  server.use(
    http.post('https://api.deepseek.com/chat/completions', () =>
      response('{"ok":"sensitive-output"}'),
    ),
  );
  await expect(
    provider().completeJSON({
      tier: 'fast',
      system: 'json',
      user: 'Test',
      schema: z.object({ ok: z.boolean() }),
    }),
  ).rejects.toMatchObject({ code: 'llm_output_invalid', message: 'llm_output_invalid' });
});
