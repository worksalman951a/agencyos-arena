/**
 * Regression: estimates are historical and read-only.
 *
 * Estimates were retired when the approved Quotation → Invoice workflow
 * (agreement optional) replaced them. This suite pins the retirement contract,
 * so it fails if a future change re-introduces any estimate mutation:
 *
 *  1. the pure contract (`lib/sales/estimate-retirement.ts`) names every retired
 *     action and answers one coded, non-disclosing refusal;
 *  2. every service mutation symbol refuses with that code **before** touching
 *     the database — no session lookup, no permission check, no write;
 *  3. historical reads still work and keep their tenant scoping
 *     (`id + organizationId`, 404 for another organization);
 *  4. the automation executor can no longer `set_status` an Estimate;
 *  5. the product ships no estimate create/edit/convert entry point, and no
 *     component renders a mutation action.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/db', () => ({
  prisma: {
    estimate: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    contact: { findFirst: vi.fn(), findMany: vi.fn() },
    auditLog: { create: vi.fn() },
    invoice: { create: vi.fn() },
    $transaction: vi.fn(),
    $queryRawUnsafe: vi.fn(),
  },
}));

vi.mock('@/lib/permissions', () => ({
  requirePermission: vi.fn(),
  requireOrganization: vi.fn(),
}));

vi.mock('@/lib/auth-server', () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import * as estimateService from '@/lib/services/crm/estimate-service';
import {
  ESTIMATE_READ_ONLY_CODE,
  ESTIMATE_READ_ONLY_MESSAGE,
  RETIRED_ESTIMATE_ACTIONS,
  estimateRetiredBody,
  estimateRetiredError,
  isEstimateRetiredError,
} from '@/lib/sales/estimate-retirement';

const mockEstimateFindFirst = prisma.estimate.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockEstimateFindMany = prisma.estimate.findMany as unknown as ReturnType<typeof vi.fn>;
const mockEstimateCreate = prisma.estimate.create as unknown as ReturnType<typeof vi.fn>;
const mockEstimateUpdate = prisma.estimate.update as unknown as ReturnType<typeof vi.fn>;
const mockEstimateDelete = prisma.estimate.delete as unknown as ReturnType<typeof vi.fn>;
const mockAuditLogCreate = prisma.auditLog.create as unknown as ReturnType<typeof vi.fn>;
const mockInvoiceCreate = prisma.invoice.create as unknown as ReturnType<typeof vi.fn>;
const mockTransaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;
const mockRequirePermission = requirePermission as unknown as ReturnType<typeof vi.fn>;
const mockRequireOrganization = requireOrganization as unknown as ReturnType<typeof vi.fn>;
const mockGetSession = auth.api.getSession as unknown as ReturnType<typeof vi.fn>;
const mockCookies = cookies as unknown as ReturnType<typeof vi.fn>;

const historicalEstimate = {
  id: 'est-historical',
  organizationId: 'org-1',
  number: 'EST-2025-0007',
  clientId: 'contact-1',
  status: 'accepted',
  total: '250.00',
  currency: 'EUR',
  validUntil: null,
  notes: 'Signed off before the retirement',
  createdAt: new Date('2025-06-01T10:00:00.000Z'),
  updatedAt: new Date('2025-06-02T10:00:00.000Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCookies.mockResolvedValue({ toString: () => 'session=abc' });
  mockGetSession.mockResolvedValue({
    session: { id: 's1' },
    user: { id: 'user-1', email: 'user@example.com' },
  });
  mockRequireOrganization.mockResolvedValue({ organizationId: 'org-1' });
  mockRequirePermission.mockResolvedValue(undefined);
  mockEstimateFindFirst.mockResolvedValue(historicalEstimate);
  mockEstimateFindMany.mockResolvedValue([historicalEstimate]);
  (prisma.contact.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: 'contact-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@client.invalid' },
  ]);
});

describe('retirement contract', () => {
  it('names every retired mutation action', () => {
    expect([...RETIRED_ESTIMATE_ACTIONS].sort()).toEqual(
      ['convert', 'create', 'delete', 'duplicate', 'edit', 'send', 'status_change'].sort()
    );
  });

  it('produces a 403 with a stable code and a replacement-workflow message', () => {
    const error = estimateRetiredError('create');

    expect(error.statusCode).toBe(403);
    expect(error.code).toBe(ESTIMATE_READ_ONLY_CODE);
    expect(error.action).toBe('create');
    expect(error.message).toBe(ESTIMATE_READ_ONLY_MESSAGE);
    expect(isEstimateRetiredError(error)).toBe(true);
    expect(isEstimateRetiredError(new Error('nope'))).toBe(false);
  });

  it('never leaks a record id or tenant in the refusal body', () => {
    const body = estimateRetiredBody('convert');
    const serialized = JSON.stringify(body);

    expect(body.code).toBe(ESTIMATE_READ_ONLY_CODE);
    expect(body.action).toBe('convert');
    expect(serialized).not.toMatch(/org-|est-|contact-|@/);
  });
});

describe('all estimate mutations are refused before any database access', () => {
  // Each entry: the exported symbol and the action it must report. The stubs
  // take no arguments on purpose — nothing a caller passes can change the
  // answer.
  const mutations: Array<[string, keyof typeof estimateService, string]> = [
    ['create', 'createEstimate', 'create'],
    ['edit', 'updateEstimate', 'edit'],
    ['duplicate', 'duplicateEstimate', 'duplicate'],
    ['send', 'sendEstimate', 'send'],
    ['status change', 'transitionEstimateStatus', 'status_change'],
    ['delete', 'deleteEstimate', 'delete'],
    ['convert', 'convertEstimateToInvoice', 'convert'],
  ];

  it.each(mutations)('refuses %s', async (_label, symbol, action) => {
    const mutation = estimateService[symbol] as unknown as () => Promise<unknown>;

    await expect(mutation()).rejects.toMatchObject({
      statusCode: 403,
      code: ESTIMATE_READ_ONLY_CODE,
      action,
    });

    // The refusal is unconditional: no session, permission, audit, or write.
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockRequirePermission).not.toHaveBeenCalled();
    expect(mockRequireOrganization).not.toHaveBeenCalled();
    expect(mockEstimateCreate).not.toHaveBeenCalled();
    expect(mockEstimateUpdate).not.toHaveBeenCalled();
    expect(mockEstimateDelete).not.toHaveBeenCalled();
    expect(mockInvoiceCreate).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });

  it('no longer exports a duplicate/send path with server-side effects', () => {
    // `duplicateEstimate` and `sendEstimate` exist only as fail-closed stubs so
    // an old in-process caller gets the coded refusal instead of a TypeError.
    for (const symbol of ['duplicateEstimate', 'sendEstimate'] as const) {
      const fn = estimateService[symbol] as unknown as () => Promise<unknown>;
      expect(typeof fn).toBe('function');
      expect(fn).toBeTypeOf('function');
    }
  });

  it('keeps no write in the service module source', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'lib/services/crm/estimate-service.ts'),
      'utf8'
    );

    // No Prisma write delegate or transaction survives in the module at all.
    expect(source).not.toMatch(
      /prisma\.estimate\.(create|update|updateMany|delete|deleteMany|upsert)/
    );
    expect(source).not.toMatch(/tx\.estimate\.(create|update|delete|upsert)/);
    expect(source).not.toMatch(/\$transaction/);
    expect(source).not.toMatch(/allocateDocumentNumber/);
    expect(source).not.toMatch(/invoice\.create/);

    // Reads and the read permission are still there.
    expect(source).toContain('prisma.estimate.findMany');
    expect(source).toContain('prisma.estimate.findFirst');
    expect(source).toContain("'estimate.read'");
  });
});

describe('historical reads are preserved', () => {
  it('lists every estimate in the caller organization', async () => {
    const list = await estimateService.listEstimates();

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: 'est-historical',
      number: 'EST-2025-0007',
      status: 'accepted',
      total: '250.00',
    });
    expect(mockRequirePermission).toHaveBeenCalledWith('user-1', 'org-1', 'estimate.read');
    expect(mockEstimateFindMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('reads one estimate with id + organizationId', async () => {
    const estimate = await estimateService.getEstimate('est-historical');

    expect(estimate.id).toBe('est-historical');
    expect(mockEstimateFindFirst).toHaveBeenCalledWith({
      where: { id: 'est-historical', organizationId: 'org-1' },
    });
  });

  it('answers a non-disclosing 404 for another organization', async () => {
    mockEstimateFindFirst.mockResolvedValueOnce(null);

    await expect(estimateService.getEstimate('est-foreign')).rejects.toMatchObject({
      message: 'Not found',
      statusCode: 404,
    });
  });
});

describe('automation cannot mutate an estimate', () => {
  it('does not list Estimate as a writable status target', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'lib/services/automation/run-workflow-service.ts'),
      'utf8'
    );
    const allowList = source.slice(
      source.indexOf('const STATUS_WRITABLE_RECORDS'),
      source.indexOf('};', source.indexOf('const STATUS_WRITABLE_RECORDS'))
    );

    expect(allowList).not.toContain('Estimate');
    // The read-only guard exists and names the record type.
    expect(source).toContain('READ_ONLY_RECORD_TYPES');
    expect(source).toMatch(/READ_ONLY_RECORD_TYPES = new Set\(\[.?'Estimate'/);
  });
});

describe('the UI ships no estimate mutation entry point', () => {
  const appRoot = path.join(process.cwd(), 'app', 'finance', 'estimates');

  it('deletes the create, edit and convert pages', () => {
    expect(fs.existsSync(path.join(appRoot, 'new'))).toBe(false);
    expect(fs.existsSync(path.join(appRoot, '[id]', 'edit'))).toBe(false);
    expect(fs.existsSync(path.join(appRoot, '[id]', 'convert'))).toBe(false);
  });

  it('deletes the status/delete action bar', () => {
    expect(fs.existsSync(path.join(appRoot, '[id]', 'EstimateActions.tsx'))).toBe(false);
  });

  it('keeps the historical list, record and PDF surfaces', () => {
    expect(fs.existsSync(path.join(appRoot, 'page.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(appRoot, '[id]', 'page.tsx'))).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          process.cwd(),
          'app',
          'api',
          'v1',
          'finance',
          'estimates',
          '[id]',
          'pdf',
          'route.ts'
        )
      )
    ).toBe(true);
  });

  it('renders no edit, delete or convert control on the estimate screens', () => {
    const files = [
      'app/finance/estimates/[id]/estimate-detail-client.tsx',
      'components/finance/bento-estimate-record-view.tsx',
      'components/finance/bento-estimates-view.tsx',
      'app/finance/estimates/estimates-client.tsx',
    ];

    for (const file of files) {
      const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
      // No links into the retired mutation pages…
      expect(source, file).not.toMatch(/\/finance\/estimates\/\$\{[^}]+\}\/(edit|convert)/);
      // …no mutation verbs against the API…
      expect(source, file).not.toMatch(/method:\s*'(PUT|PATCH|DELETE)'/);
      // …and no shipped action labels.
      expect(source, file).not.toMatch(/Convert to Invoice|Delete Estimate|Mark as Sent/);
    }
  });
});
