import { createWorkspace, type Workspace } from '@openself/core/workspace';
import { getRuntime } from './runtime';
import { getTestContext } from './test-context';
let workspace: Workspace | undefined;
export function getWorkspace() {
  const test = getTestContext();
  if (test) return test.workspace;
  return (workspace ??= createWorkspace(getRuntime().db, getRuntime().env));
}
