/**
 * AgencyOS CRM Invoices API - Single Invoice
 *
 * GET    /api/v1/crm/invoices/[id] - Get invoice by ID
 * PUT    /api/v1/crm/invoices/[id] - Update invoice with line items
 * DELETE /api/v1/crm/invoices/[id] - Soft delete invoice
 *
 * Organization ID is resolved from the authenticated user's session,
 * never accepted from the client. Cross-org lookups return non-disclosing 404.
 */

import { NextResponse } from 'next/server';

import { getInvoice, updateInvoice, deleteInvoice } from '@/lib/services/crm/invoice-service';
import { invoiceUpdateSchema, invoiceLineItemSchema } from '@/lib/schemas/crm/invoice.schema';
import { apiErrorFrom } from '@/lib/api/route-error';

function errorResponse(message: string, status: number, issues?: unknown[]) {
  const body: Record<string, unknown> = { error: message };
  if (issues) body.issues = issues;
  return NextResponse.json(body, { status });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const invoice = await getInvoice(id);
    return NextResponse.json(invoice);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const body = await request.json();
    const { lineItems: lineItemsRaw, ...updateInput } = body;
    const parsed = invoiceUpdateSchema.safeParse(updateInput);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, parsed.error.issues);
    }

    let lineItems:
      | Array<{
          description: string;
          quantity: string;
          unitPrice: string;
          taxRate: string;
        }>
      | undefined;

    if (lineItemsRaw !== undefined) {
      if (!Array.isArray(lineItemsRaw) || lineItemsRaw.length === 0) {
        return errorResponse('At least one line item is required', 400);
      }

      lineItems = [];
      for (const item of lineItemsRaw) {
        const itemParsed = invoiceLineItemSchema.safeParse(item);
        if (!itemParsed.success) {
          return errorResponse('Invalid line item', 400, itemParsed.error.issues);
        }
        lineItems.push(itemParsed.data);
      }
    }

    const invoice = await updateInvoice(id, parsed.data, lineItems);
    return NextResponse.json(invoice);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await deleteInvoice(id);
    return NextResponse.json(result);
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return errorResponse(message, status);
  }
}
