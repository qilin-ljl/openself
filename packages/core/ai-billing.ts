import { type Database, eq, schema, sql } from '@openself/db';
import type { Environment } from '@openself/shared/env';
import { AppError } from '@openself/shared/errors';
import { decrypt } from './crypto';
import { createDeepSeekProvider } from '@openself/llm/provider';
export type Billing = { source: 'own' | 'platform'; kind: 'review' | 'issue' | 'aux'; day: string };
type Executor = Pick<Database, 'select' | 'insert' | 'update'>;
export const beijingDate = (now = new Date()) =>
  new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
export async function reserveAI(
  tx: Executor,
  userId: string,
  kind: Billing['kind'],
): Promise<Billing> {
  const [key] = await tx
    .select()
    .from(schema.userApiKeys)
    .where(eq(schema.userApiKeys.userId, userId));
  if (!key) throw new AppError('llm_key_required', 409);
  const source = 'own',
    day = beijingDate(),
    counterKind = source + '.' + kind;
  await tx
    .insert(schema.usageCounters)
    .values({ userId, date: day, kind: counterKind, count: 1 })
    .onConflictDoUpdate({
      target: [schema.usageCounters.userId, schema.usageCounters.date, schema.usageCounters.kind],
      set: { count: sql`${schema.usageCounters.count}+1` },
    });
  return { source, day, kind };
}
export async function resolveProvider(
  db: Database,
  env: Environment,
  userId: string,
  billing: Billing,
  transport?: typeof fetch,
  observe?: (usage: { input: number; output: number; cacheHit: number }) => void,
) {
  // Refuse old platform-funded jobs as well as new requests without a personal key.
  if (billing.source !== 'own') throw new AppError('llm_key_required', 409);
  const [own] = await db
    .select()
    .from(schema.userApiKeys)
    .where(eq(schema.userApiKeys.userId, userId));
  if (!own) throw new AppError('llm_key_missing', 409);
  const key = decrypt(own.keyEnc, env.ENCRYPTION_KEY);
  return createDeepSeekProvider({
    fetch: transport,
    apiKey: key,
    baseURL: env.DEEPSEEK_BASE_URL,
    models: { fast: env.LLM_MODEL_FAST, deep: env.LLM_MODEL_DEEP },
    deepThinking: env.LLM_DEEP_THINKING === 'enabled',
    onUsage: async (usage) => {
      observe?.(usage);
      await db
        .insert(schema.usageCounters)
        .values({
          userId,
          date: billing.day,
          kind: billing.source + '.' + billing.kind,
          tokensIn: usage.input,
          tokensOut: usage.output,
        })
        .onConflictDoUpdate({
          target: [
            schema.usageCounters.userId,
            schema.usageCounters.date,
            schema.usageCounters.kind,
          ],
          set: {
            tokensIn: sql`${schema.usageCounters.tokensIn}+${usage.input}`,
            tokensOut: sql`${schema.usageCounters.tokensOut}+${usage.output}`,
          },
        });
    },
  });
}
