import { NextResponse } from 'next/server';

import { apiErrorFrom } from '@/lib/api/route-error';
import { getProjectFinancialSummary } from '@/lib/services/crm/project-financial-summary-service';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await getProjectFinancialSummary(id));
  } catch (error) {
    const { status, message } = apiErrorFrom(error);
    return NextResponse.json({ error: message }, { status });
  }
}
