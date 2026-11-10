/**
 * AgencyOS Automation Coming Soon page.
 *
 * Placeholder for the Automation module, planned for a future AgencyOS release.
 * Not a functional module - does not execute workflows or automations.
 */

import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ComingSoon } from '@/components/layout/coming-soon';

export const dynamic = 'force-dynamic';

export default async function WorkflowsPage() {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    redirect('/login');
  }

  return (
    <ComingSoon
      title="Automation"
      phase="Roadmap: Future Phase"
      description="Automate repetitive tasks with workflows. Automation is planned for a future AgencyOS release."
    />
  );
}
