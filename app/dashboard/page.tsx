import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCurrentPermissions } from '@/lib/current-user';
import {
  getDashboardMetrics,
  getOpenOpportunities,
  getRecentActivity,
} from '@/lib/services/dashboard/dashboard-service';
import { DashboardClientView } from './dashboard-client-view';

/**
 * AgencyOS dashboard page (Server Component).
 *
 * Every metric on this page comes from the database for the signed-in user's
 * organization with strict permission scoping.
 *
 * Dual Presentation:
 * - If Bento shell is enabled (default), renders BentoDashboardView.
 * - If Bento shell is explicitly opted-out, renders legacy Card view.
 */

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    redirect('/login');
  }

  const [permissions, metrics, opportunities, activity] = await Promise.all([
    getCurrentPermissions(),
    getDashboardMetrics(),
    getOpenOpportunities(),
    getRecentActivity(8),
  ]);

  const canCreateProject = permissions.has('project.create');
  const canReadProjects = permissions.has('project.read');

  return (
    <DashboardClientView
      metrics={metrics}
      opportunities={opportunities}
      activity={activity}
      canCreateProject={canCreateProject}
      canReadProjects={canReadProjects}
    />
  );
}
