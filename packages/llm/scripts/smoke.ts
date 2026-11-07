import { config } from 'dotenv';
import OpenAI from 'openai';
import { z } from 'zod';
config({ path: '../../.env', quiet: true });
if (!process.env.DEEPSEEK_API_KEY) {
  console.error('Smoke test blocked: set DEEPSEEK_API_KEY in the root .env. No API call was made.');
  process.exit(2);
}
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
  maxRetries: 0,
});
for (const thinking of ['enabled', 'disabled'] as const) {
  try {
    const response = await client.chat.completions.create({
      model: process.env.LLM_MODEL_DEEP ?? 'deepseek-v4-pro',
      messages: [
        { role: 'system', content: 'Return json only. Example: {"ok":true}' },
        { role: 'user', content: 'Return the example.' },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1024,
      thinking: { type: thinking },
      ...(thinking === 'enabled' ? { reasoning_effort: 'high' } : {}),
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
    const result = z
      .object({ ok: z.literal(true) })
      .safeParse(JSON.parse(response.choices[0]?.message.content ?? ''));
    console.info(JSON.stringify({ thinking, jsonValid: result.success, usage: response.usage }));
    if (!result.success) process.exitCode = 1;
  } catch {
    console.info(JSON.stringify({ thinking, jsonValid: false, error: 'request_failed' }));
    process.exitCode = 1;
  }
}
