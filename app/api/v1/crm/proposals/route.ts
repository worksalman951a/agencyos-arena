/**
 * AgencyOS CRM Proposals API
 *
 * GET    /api/v1/crm/proposals          - List proposals (org-scoped, paginated)
 * POST   /api/v1/crm/proposals          - Create a proposal with line items
 *
 * Organization ID is resolved from the authenticated user's session,
 * never accepted from the client. Cross-org lookups return non-disclosing 404.
 */

import { NextResponse } from 'next/server';

import { listProposals, createProposal } from '@/lib/services/crm/proposal-service';
import {
  proposalCreateSchema,
  proposalQuerySchema,
  proposalLineItemSchema,
} from '@/lib/schemas/crm/proposal.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

/** Whitelisted sortable fields */
const ALLOWED_SORT_FIELDS = ['title', 'status', 'total', 'createdAt', 'updatedAt'];

/** Error response helper */
function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

/** GET /api/v1/crm/proposals - List proposals */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = Object.fromEntries(searchParams.entries());

    const parsed = proposalQuerySchema.safeParse(query);
    if (!parsed.success) {
      return errorResponse('Invalid query parameters', 400, parsed.error.issues);
    }

    if (parsed.data.sortBy && !ALLOWED_SORT_FIELDS.includes(parsed.data.sortBy)) {
      return errorResponse('Invalid sort field', 400);
    }

    const data = await listProposals(parsed.data);
    return NextResponse.json(data);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

/** POST /api/v1/crm/proposals - Create proposal */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    // Strip lineItems before strict Zod validation (validated separately below)
    const { lineItems: lineItemsRaw, ...createInput } = body;
    const parsed = proposalCreateSchema.safeParse(createInput);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    // Validate and parse line items (always required)
    if (!Array.isArray(lineItemsRaw) || lineItemsRaw.length === 0) {
      return errorResponse('At least one line item is required', 400);
    }

    const lineItems = [];
    for (const item of lineItemsRaw) {
      const itemParsed = proposalLineItemSchema.safeParse(item);
      if (!itemParsed.success) {
        return errorResponse('Invalid line item', 400, itemParsed.error.issues);
      }
      lineItems.push(itemParsed.data);
    }

    const proposal = await createProposal(parsed.data, lineItems);
    return NextResponse.json(proposal, { status: 201 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
