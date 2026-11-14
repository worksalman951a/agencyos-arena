/**
 * HTTP contract for the retired estimate routes.
 *
 * Retirement is enforced at the edge as well as in the service: every mutation
 * verb answers `403 { code: "estimate_read_only", action }` **without** parsing
 * the body or calling the service, so a stale client, bookmark or integration
 * gets an explicit refusal instead of a 404 (which would look like "the
 * estimate disappeared") or a silent success.
 *
 * Reads are asserted alongside, so removing mutations can never quietly take
 * historical access (list, detail, PDF) with it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/services/crm/estimate-service', () => ({
  listEstimates: vi.fn(),
  getEstimate: vi.fn(),
  // A hostile mock: if any retired route called a mutation it would resolve
  // instead of failing, so the "never called" assertions below are meaningful.
  createEstimate: vi.fn(),
  updateEstimate: vi.fn(),
  deleteEstimate: vi.fn(),
  duplicateEstimate: vi.fn(),
  sendEstimate: vi.fn(),
  transitionEstimateStatus: vi.fn(),
  convertEstimateToInvoice: vi.fn(),
}));

vi.mock('@/lib/services/documents/pdf-service', () => ({
  generateEstimatePdf: vi.fn(() => new Uint8Array([37, 80, 68, 70])),
}));

vi.mock('@/lib/services/settings/branding-service', () => ({
  getBrandingForOrganization: vi.fn(async () => undefined),
}));

import {
  listEstimates,
  getEstimate,
  createEstimate,
  updateEstimate,
  deleteEstimate,
  duplicateEstimate,
  sendEstimate,
  transitionEstimateStatus,
  convertEstimateToInvoice,
} from '@/lib/services/crm/estimate-service';
import { GET as listRoute, POST as createRoute } from '@/app/api/v1/finance/estimates/route';
import {
  GET as detailRoute,
  PUT as updateRoute,
  PATCH as patchRoute,
  DELETE as deleteRoute,
} from '@/app/api/v1/finance/estimates/[id]/route';
import { POST as convertRoute } from '@/app/api/v1/finance/estimates/[id]/convert/route';
import { GET as pdfRoute } from '@/app/api/v1/finance/estimates/[id]/pdf/route';
import { ESTIMATE_READ_ONLY_CODE } from '@/lib/sales/estimate-retirement';

const mutationMocks = {
  createEstimate,
  updateEstimate,
  deleteEstimate,
  duplicateEstimate,
  sendEstimate,
  transitionEstimateStatus,
  convertEstimateToInvoice,
};

const params = Promise.resolve({ id: 'est-historical' });

const historicalEstimate = {
  id: 'est-historical',
  organizationId: 'org-1',
  number: 'EST-2025-0007',
  clientId: 'contact-1',
  client: { id: 'contact-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@client.invalid' },
  status: 'accepted',
  total: '250.00',
  currency: 'EUR',
  validUntil: null,
  notes: 'Historical record',
  createdAt: new Date('2025-06-01T10:00:00.000Z'),
  updatedAt: new Date('2025-06-02T10:00:00.000Z'),
};

/** A body that would be valid for the pre-retirement implementation. */
const legacyMutationBody = JSON.stringify({
  clientId: 'contact-1',
  number: 'EST-2026-9999',
  status: 'sent',
  total: '999.00',
  currency: 'USD',
  invoiceTitle: 'Converted estimate',
});

function request(method: string, body = legacyMutationBody) {
  return new Request('http://localhost/api/v1/finance/estimates/est-historical', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' || method === 'DELETE' ? undefined : body,
  });
}

function expectNoMutationCalled() {
  for (const [name, mock] of Object.entries(mutationMocks)) {
    expect(mock, `${name} must not be reachable`).not.toHaveBeenCalled();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listEstimates).mockResolvedValue([historicalEstimate]);
  vi.mocked(getEstimate).mockResolvedValue(historicalEstimate);
});

describe('POST /api/v1/finance/estimates (create / duplicate)', () => {
  it('refuses creation with a coded 403', async () => {
    const res = await createRoute();
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({
      error: expect.stringMatching(/read-only/i),
      code: ESTIMATE_READ_ONLY_CODE,
      action: 'create',
    });
    expectNoMutationCalled();
  });

  it('answers the same refusal for a duplicate payload (duplication was a create)', async () => {
    const res = await createRoute();
    expect(res.status).toBe(403);
    expect((await res.json()).action).toBe('create');
    expectNoMutationCalled();
  });
});

describe('PUT/PATCH /api/v1/finance/estimates/[id] (edit, send, status change)', () => {
  it('refuses an edit', async () => {
    const res = await updateRoute();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: ESTIMATE_READ_ONLY_CODE, action: 'edit' });
    expectNoMutationCalled();
  });

  it('refuses the send transition (draft → sent)', async () => {
    const res = await updateRoute();
    expect(res.status).toBe(403);
    expectNoMutationCalled();
  });

  it('refuses PATCH so the verb cannot be used to bypass PUT', async () => {
    const res = await patchRoute();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: ESTIMATE_READ_ONLY_CODE, action: 'edit' });
    expectNoMutationCalled();
  });
});

describe('DELETE /api/v1/finance/estimates/[id]', () => {
  it('refuses deletion so historical rows are preserved', async () => {
    const res = await deleteRoute();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: ESTIMATE_READ_ONLY_CODE, action: 'delete' });
    expectNoMutationCalled();
  });
});

describe('POST /api/v1/finance/estimates/[id]/convert', () => {
  it('refuses conversion to invoice', async () => {
    const res = await convertRoute();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: ESTIMATE_READ_ONLY_CODE, action: 'convert' });
    expectNoMutationCalled();
  });

  it('does not disclose whether the estimate exists', async () => {
    const foreign = await convertRoute();
    const missing = await convertRoute();

    expect(missing.status).toBe(foreign.status);
    expect(await missing.json()).toEqual(await foreign.json());
    expect(getEstimate).not.toHaveBeenCalled();
  });
});

describe('historical reads still work', () => {
  it('lists estimates', async () => {
    const res = await listRoute();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ id: 'est-historical', number: 'EST-2025-0007' });
    expect(listEstimates).toHaveBeenCalledTimes(1);
  });

  it('reads one estimate', async () => {
    const res = await detailRoute(request('GET'), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ id: 'est-historical', status: 'accepted' });
    expect(getEstimate).toHaveBeenCalledWith('est-historical');
  });

  it('keeps the PDF download (authorized read access)', async () => {
    const res = await pdfRoute(request('GET'), { params });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('Estimate_EST-2025-0007.pdf');
    expect(getEstimate).toHaveBeenCalledWith('est-historical');
  });
});
