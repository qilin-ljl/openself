import { currentUser } from '../../../../lib/session';
import { WorkspaceDashboard } from '../../../../components/workspace-dashboard';
export default async function Dashboard() {
  const user = await currentUser();
  return user ? <WorkspaceDashboard login={user.login} /> : null;
}
