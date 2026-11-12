import { NextResponse } from 'next/server';
import { apiErrorFrom } from '@/lib/api/route-error';
import {
  addBillableSourcesToInvoice,
  listBillableProjectSources,
} from '@/lib/services/crm/invoice-service';
import { invoiceBillableSourcesSchema } from '@/lib/schemas/crm/invoice.schema';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sources = await listBillableProjectSources(id);
    return NextResponse.json(sources);
  } catch (error) {
    const { status, message } = apiErrorFrom(error);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body: unknown = await request.json();
    const parsed = invoiceBillableSourcesSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid billable source selection', issues: parsed.error.issues },
        { status: 400 }
      );
    }
    const { id } = await params;
    const invoice = await addBillableSourcesToInvoice(id, parsed.data);
    return NextResponse.json(invoice);
  } catch (error) {
    const { status, message } = apiErrorFrom(error);
    return NextResponse.json({ error: message }, { status });
  }
}
