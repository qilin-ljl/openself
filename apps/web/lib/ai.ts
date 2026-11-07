import { createAIService, type AIService } from '@openself/core/ai-service';
import { getRuntime } from './runtime';
import { getWorkspace } from './workspace';
import { getTestContext } from './test-context';
let service: AIService | undefined;
let factory: typeof createAIService | undefined;
export function getAI() {
  const test = getTestContext();
  if (test?.ai) return test.ai;
  if (service && factory === createAIService) return service;
  factory = createAIService;
  return (service = createAIService({
    db: getRuntime().db,
    env: getRuntime().env,
    workspace: getWorkspace(),
  }));
}
