/**
 * AgencyOS CRM Contact Edit page.
 * Server component that fetches the contact and renders the edit form.
 */

import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getContact } from '@/lib/services/crm/contact-service';
import { EditContactForm } from './EditContactForm';

export default async function ContactEditPage({ params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    redirect('/login');
  }

  const { id } = await params;
  const contact = await getContact(id);

  return <EditContactForm contact={contact} />;
}
