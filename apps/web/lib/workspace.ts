import { createWorkspace, type Workspace } from '@openself/core/workspace';
import { getRuntime } from './runtime';
import { getTestContext } from './test-context';
let workspace: Workspace | undefined;
let factory: typeof createWorkspace | undefined;
export function getWorkspace() {
  const test = getTestContext();
  if (test) return test.workspace;
  if (workspace && factory === createWorkspace) return workspace;
  factory = createWorkspace;
  return (workspace = createWorkspace(getRuntime().db, getRuntime().env));
}
