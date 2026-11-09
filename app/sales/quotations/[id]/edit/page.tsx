/**
 * AgencyOS Sales Quotation Edit page.
 *
 * Redirects to the Phase 2.2 Live Preview Builder for editing an existing
 * quotation. Preserves the /sales/quotations/[id]/edit route as the entry point.
 * The builder loads the saved quotation values and line items from the API.
 */

import { redirect } from 'next/navigation';

export default async function QuotationEditPage({
  params,
}: {
  // Next.js 16 supplies params as a Promise in server components too;
  // reading it synchronously produced a redirect to ".../undefined".
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/sales/quotations/builder/${id}`);
}
