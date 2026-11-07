import { z } from 'zod';
const Environment = z
  .object({
    APP_URL: z.url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol)),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().regex(/^postgres(?:ql)?:\/\//),
    REDIS_URL: z.string().regex(/^rediss?:\/\//),
    GITHUB_CLIENT_ID: z.string().min(1),
    GITHUB_CLIENT_SECRET: z.string().min(1),
    ENCRYPTION_KEY: z
      .string()
      .refine(
        (value) =>
          Buffer.from(value, 'base64').length === 32 &&
          Buffer.from(value, 'base64').toString('base64') === value,
      ),
    SESSION_COOKIE_NAME: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .default('os_session'),
    DEEPSEEK_BASE_URL: z.url().default('https://api.deepseek.com'),
    LLM_MODEL_FAST: z.string().default('deepseek-flash'),
    LLM_MODEL_DEEP: z.string().default('deepseek-v4-pro'),
    LLM_DEEP_THINKING: z.enum(['enabled', 'disabled']).default('enabled'),
    REVIEW_MAX_FILES: z.coerce.number().int().min(1).max(500).default(100),
    EXTENSION_IDS: z.string().default(''),
  })
  .refine(
    (value) => value.NODE_ENV !== 'production' || new URL(value.APP_URL).protocol === 'https:',
    { path: ['APP_URL'], message: 'HTTPS is required in production' },
  );
export type Environment = z.infer<typeof Environment>;
export function parseEnv(source: Record<string, string | undefined>): Environment {
  const result = Environment.safeParse(source);
  if (!result.success)
    throw new Error(
      'Invalid configuration: ' +
        [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(', '),
    );
  return result.data;
}
