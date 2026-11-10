/**
 * AgencyOS CRM Invoices API
 *
 * GET    /api/v1/crm/invoices          - List invoices (org-scoped, paginated)
 * POST   /api/v1/crm/invoices          - Create an invoice with line items
 *
 * Organization ID is resolved from the authenticated user's session,
 * never accepted from the client. Cross-org lookups return non-disclosing 404.
 */

import { NextResponse } from 'next/server';

import { listInvoices, createInvoice } from '@/lib/services/crm/invoice-service';
import {
  invoiceCreateSchema,
  invoiceQuerySchema,
  invoiceLineItemSchema,
} from '@/lib/schemas/crm/invoice.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

const ALLOWED_SORT_FIELDS = ['title', 'status', 'total', 'createdAt', 'updatedAt', 'dueDate'];

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = Object.fromEntries(searchParams.entries());

    const parsed = invoiceQuerySchema.safeParse(query);
    if (!parsed.success) {
      return errorResponse('Invalid query parameters', 400, parsed.error.issues);
    }

    if (parsed.data.sortBy && !ALLOWED_SORT_FIELDS.includes(parsed.data.sortBy)) {
      return errorResponse('Invalid sort field', 400);
    }

    const data = await listInvoices(parsed.data);
    return NextResponse.json(data);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { lineItems: lineItemsRaw, ...createInput } = body;
    const parsed = invoiceCreateSchema.safeParse(createInput);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    if (!Array.isArray(lineItemsRaw) || lineItemsRaw.length === 0) {
      return errorResponse('At least one line item is required', 400);
    }

    const lineItems = [];
    for (const item of lineItemsRaw) {
      const itemParsed = invoiceLineItemSchema.safeParse(item);
      if (!itemParsed.success) {
        return errorResponse('Invalid line item', 400, itemParsed.error.issues);
      }
      lineItems.push(itemParsed.data);
    }

    const invoice = await createInvoice(parsed.data, lineItems);
    return NextResponse.json(invoice, { status: 201 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
