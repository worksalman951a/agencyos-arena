/**
 * AgencyOS Health Dashboard page.
 * Displays system health status for database, queue, and storage.
 *
 * Bifurcated under useBentoShell().
 */

import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { checkDbHealth } from '@/lib/db-health';
import { HealthClient } from './health-client';

export const dynamic = 'force-dynamic';

export default async function HealthPage() {
  const cookieStore = await cookies();
  const session = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!session?.session || !session.user) {
    redirect('/login');
  }

  const database = await checkDbHealth();

  const services: Array<{ name: string; status: 'healthy' | 'unhealthy'; latency?: number }> = [
    {
      name: 'database',
      status: database.healthy ? 'healthy' : 'unhealthy',
      ...(database.latencyMs !== undefined ? { latency: database.latencyMs } : {}),
    },
  ];

  const allHealthy = services.every((service) => service.status === 'healthy');

  return (
    <HealthClient
      services={services}
      allHealthy={allHealthy}
      dbError={database.error}
      checkedAt={new Date().toLocaleTimeString()}
    />
  );
}
