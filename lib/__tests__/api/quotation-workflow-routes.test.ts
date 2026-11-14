/**
 * Unit tests for the two quotation workflow routes.
 *
 * The services are mocked so these tests pin the HTTP contract only:
 *  - an empty body is accepted (the quotation already carries the source data);
 *  - only whitelisted overrides are accepted (strict schemas reject anything
 *    else, so a caller cannot smuggle client/line-item data through);
 *  - successful creates answer 201 with the created document;
 *  - service errors keep their status and client-facing message.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/services/crm/invoice-service', () => ({
  createInvoiceFromQuotation: vi.fn(),
}));

vi.mock('@/lib/services/documents/contract-service', () => ({
  createAgreementFromQuotation: vi.fn(),
}));

import { createInvoiceFromQuotation } from '@/lib/services/crm/invoice-service';
import { createAgreementFromQuotation } from '@/lib/services/documents/contract-service';
import { POST as postInvoice } from '@/app/api/v1/crm/quotations/[id]/invoice/route';
import { POST as postAgreement } from '@/app/api/v1/crm/quotations/[id]/agreement/route';

const mockCreateInvoice = createInvoiceFromQuotation as unknown as ReturnType<typeof vi.fn>;
const mockCreateAgreement = createAgreementFromQuotation as unknown as ReturnType<typeof vi.fn>;

const params = Promise.resolve({ id: 'quotation_accepted' });

function jsonRequest(body?: unknown, rawBody?: string) {
  return new Request('http://localhost/api/v1/crm/quotations/quotation_accepted/invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(rawBody !== undefined
      ? { body: rawBody }
      : body !== undefined
        ? { body: JSON.stringify(body) }
        : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateInvoice.mockResolvedValue({ id: 'invoice_1', number: 'INV-2026-0001' });
  mockCreateAgreement.mockResolvedValue({ id: 'contract_1', title: 'Agreement' });
});

describe('POST /api/v1/crm/quotations/[id]/invoice', () => {
  it('creates an invoice from an accepted quotation with an empty body', async () => {
    const res = await postInvoice(jsonRequest(), { params });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: 'invoice_1', number: 'INV-2026-0001' });
    expect(mockCreateInvoice).toHaveBeenCalledWith('quotation_accepted', {});
  });

  it('accepts the document-owned overrides', async () => {
    const res = await postInvoice(
      jsonRequest({ title: 'Milestone 1', dueDate: '2026-12-31', notes: 'First instalment' }),
      { params }
    );

    expect(res.status).toBe(201);
    expect(mockCreateInvoice).toHaveBeenCalledWith('quotation_accepted', {
      title: 'Milestone 1',
      dueDate: '2026-12-31',
      notes: 'First instalment',
    });
  });

  it('rejects source fields instead of trusting the client', async () => {
    const res = await postInvoice(
      jsonRequest({ clientId: 'attacker', lineItems: [], quotationId: 'other', total: '1.00' }),
      { params }
    );

    expect(res.status).toBe(400);
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });

  it('maps a service rejection to its status and message', async () => {
    const error = Object.assign(new Error('Only accepted quotations can be invoiced'), {
      statusCode: 400,
    });
    mockCreateInvoice.mockRejectedValue(error);

    const res = await postInvoice(jsonRequest(), { params });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Only accepted quotations can be invoiced' });
  });

  it('does not disclose another tenant as anything but 404', async () => {
    mockCreateInvoice.mockRejectedValue(Object.assign(new Error('Not found'), { statusCode: 404 }));

    const res = await postInvoice(jsonRequest(), { params });

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'Not found' });
  });
});

describe('POST /api/v1/crm/quotations/[id]/agreement', () => {
  it('creates an agreement from an accepted quotation', async () => {
    const res = await postAgreement(jsonRequest(), { params });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: 'contract_1', title: 'Agreement' });
    expect(mockCreateAgreement).toHaveBeenCalledWith('quotation_accepted', {});
  });

  it('accepts a title override only', async () => {
    const res = await postAgreement(jsonRequest({ title: 'Master Services Agreement' }), {
      params,
    });

    expect(res.status).toBe(201);
    expect(mockCreateAgreement).toHaveBeenCalledWith('quotation_accepted', {
      title: 'Master Services Agreement',
    });
  });

  it('rejects source fields and malformed bodies', async () => {
    const withSource = await postAgreement(
      jsonRequest({ proposalId: 'proposal_1', projectId: 'project_1' }),
      { params }
    );
    expect(withSource.status).toBe(400);

    const malformed = await postAgreement(jsonRequest(undefined, '{not json'), { params });
    expect(malformed.status).toBe(400);

    expect(mockCreateAgreement).not.toHaveBeenCalled();
  });

  it('maps a service rejection to its status', async () => {
    mockCreateAgreement.mockRejectedValue(
      Object.assign(new Error('Only accepted quotations can produce an agreement'), {
        statusCode: 400,
      })
    );

    const res = await postAgreement(jsonRequest(), { params });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'Only accepted quotations can produce an agreement',
    });
  });
});
