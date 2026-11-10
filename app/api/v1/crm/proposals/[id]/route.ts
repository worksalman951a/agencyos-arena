/**
 * AgencyOS CRM Proposals API - Single Proposal
 *
 * GET    /api/v1/crm/proposals/[id] - Get proposal by ID
 * PUT    /api/v1/crm/proposals/[id] - Update proposal with line items
 * DELETE /api/v1/crm/proposals/[id] - Soft delete proposal
 *
 * Organization ID is resolved from the authenticated user's session,
 * never accepted from the client. Cross-org lookups return non-disclosing 404.
 */

import { NextResponse } from 'next/server';

import { getProposal, updateProposal, deleteProposal } from '@/lib/services/crm/proposal-service';
import { proposalUpdateSchema, proposalLineItemSchema } from '@/lib/schemas/crm/proposal.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

/** Error response helper */
function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

/** GET /api/v1/crm/proposals/[id] - Get proposal by ID */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const proposal = await getProposal(id);
    return NextResponse.json(proposal);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

/** PUT /api/v1/crm/proposals/[id] - Update proposal */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const body = await request.json();
    // Strip lineItems before strict Zod validation (validated separately below)
    const { lineItems: lineItemsRaw, ...updateInput } = body;
    const parsed = proposalUpdateSchema.safeParse(updateInput);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    // Parse line items if provided
    let lineItems:
      | Array<{
          description: string;
          quantity: string;
          unitPrice: string;
          taxRate: string;
          sortOrder: number;
        }>
      | undefined;

    if (lineItemsRaw !== undefined) {
      if (!Array.isArray(lineItemsRaw) || lineItemsRaw.length === 0) {
        return errorResponse('At least one line item is required', 400);
      }

      lineItems = [];
      for (const item of lineItemsRaw) {
        const itemParsed = proposalLineItemSchema.safeParse(item);
        if (!itemParsed.success) {
          return errorResponse('Invalid line item', 400, itemParsed.error.issues);
        }
        lineItems.push(itemParsed.data);
      }
    }

    const proposal = await updateProposal(id, parsed.data, lineItems);
    return NextResponse.json(proposal);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

/** DELETE /api/v1/crm/proposals/[id] - Soft delete proposal */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await deleteProposal(id);
    return NextResponse.json(result);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
