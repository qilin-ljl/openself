import type { Database } from '@openself/db';
import type { Environment } from '@openself/shared/env';
import type { createSessionService } from '@openself/core/session';
import type { Workspace } from '@openself/core/workspace';
import type { AIService } from '@openself/core/ai-service';
export type TestContext = {
  db: Database;
  env: Environment;
  sessions: ReturnType<typeof createSessionService>;
  workspace: Workspace;
  userId: string;
  contributionUserId?: string;
  ai?: AIService;
};
declare global {
  var __openselfTestContext: TestContext | undefined;
}
export function testAuthEnabled() {
  return process.env.NODE_ENV !== 'production' && process.env.E2E_FAKE_AUTH === '1';
}
export function getTestContext() {
  return testAuthEnabled() ? globalThis.__openselfTestContext : undefined;
}
