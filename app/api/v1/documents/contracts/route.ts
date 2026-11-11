/**
 * AgencyOS Documents API - Contracts
 *
 * GET    /api/v1/documents/contracts - List contracts
 * POST   /api/v1/documents/contracts - Create a contract
 */

import { NextResponse } from 'next/server';

import { listContracts, createContract } from '@/lib/services/documents/contract-service';
import { contractCreateSchema } from '@/lib/schemas/documents/contract.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function GET() {
  try {
    const data = await listContracts();
    return NextResponse.json(data);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = contractCreateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const contract = await createContract(parsed.data);
    return NextResponse.json(contract, { status: 201 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
