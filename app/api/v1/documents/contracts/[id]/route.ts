/**
 * AgencyOS Documents API - Single Contract
 *
 * GET    /api/v1/documents/contracts/[id] - Get contract by ID
 * PUT    /api/v1/documents/contracts/[id] - Update contract
 * DELETE /api/v1/documents/contracts/[id] - Delete contract
 * POST   /api/v1/documents/contracts/[id] - Sign contract
 */

import { NextResponse } from 'next/server';

import {
  getContract,
  updateContract,
  deleteContract,
  signContract,
} from '@/lib/services/documents/contract-service';
import { contractUpdateSchema, contractSignSchema } from '@/lib/schemas/documents/contract.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const contract = await getContract(id);
    return NextResponse.json(contract);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = contractUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const contract = await updateContract(id, parsed.data);
    return NextResponse.json(contract);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await deleteContract(id);
    return NextResponse.json(result);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = contractSignSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    const ipAddress =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      null;
    const userAgent = request.headers.get('user-agent') ?? null;

    const result = await signContract(id, parsed.data, ipAddress, userAgent);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
