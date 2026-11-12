import { redirect } from 'next/navigation';
import { getClientPortalSession } from '@/lib/services/portal/portal-auth-service';
import { BentoPortalShell } from '@/components/portal/bento-portal-shell';

export default async function ClientPortalLayout({ children }: { children: React.ReactNode }) {
  let context;
  try {
    context = await getClientPortalSession();
  } catch {
    redirect('/portal/login');
  }

  return <BentoPortalShell context={context}>{children}</BentoPortalShell>;
}
