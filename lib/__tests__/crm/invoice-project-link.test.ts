/**
 * Unit tests for project-to-invoice linking (Phase 5A).
 *
 * Pins the service-level rules around `Invoice.projectId`:
 *
 * - linking needs `project.read` on top of the invoice permission, and an
 *   eligible project resolved inside the caller's organization;
 * - project-less invoices keep working exactly as before;
 * - a project change is decided under the invoice row lock, is refused once
 *   payments exist, and commits together with its audit entry;
 * - project details are redacted for callers who cannot read projects;
 * - the project filter is always combined with the organization scope.
 *
 * The database-level guarantee (composite foreign key) is covered against real
 * PostgreSQL in lib/__tests__/integration/finance.project-invoices.integration.test.ts.
 * Prisma, auth and permissions are mocked here.
 */

vi.mock('@/lib/db', () => ({
  prisma: {
    invoice: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    project: { findFirst: vi.fn() },
    contact: { findFirst: vi.fn() },
    payment: { count: vi.fn() },
    auditLog: { create: vi.fn() },
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

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('@/lib/services/settings/document-numbering', () => ({
  allocateDocumentNumber: vi.fn(),
}));

vi.mock('@/lib/services/automation/run-workflow-service', () => ({
  emitWorkflowEvent: vi.fn(async () => ({})),
  emitWorkflowEvents: vi.fn(async () => []),
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { allocateDocumentNumber } from '@/lib/services/settings/document-numbering';
import {
  addBillableSourcesToInvoice,
  createInvoice,
  getInvoice,
  listInvoices,
  updateInvoice,
} from '@/lib/services/crm/invoice-service';
import {
  invoiceCreateSchema,
  invoiceQuerySchema,
  invoiceUpdateSchema,
} from '@/lib/schemas/crm/invoice.schema';

type Mock = ReturnType<typeof vi.fn>;
const mockRequirePermission = requirePermission as unknown as Mock;
const mockRequireOrganization = requireOrganization as unknown as Mock;
const mockGetSession = auth.api.getSession as unknown as Mock;
const mockCookies = cookies as unknown as Mock;
const mockAllocateNumber = allocateDocumentNumber as unknown as Mock;
const mockInvoiceFindFirst = prisma.invoice.findFirst as unknown as Mock;
const mockInvoiceFindMany = prisma.invoice.findMany as unknown as Mock;
const mockInvoiceCount = prisma.invoice.count as unknown as Mock;
const mockInvoiceCreate = prisma.invoice.create as unknown as Mock;
const mockInvoiceUpdate = prisma.invoice.update as unknown as Mock;
const mockInvoiceFindUniqueOrThrow = prisma.invoice.findUniqueOrThrow as unknown as Mock;
const mockProjectFindFirst = prisma.project.findFirst as unknown as Mock;
const mockPaymentCount = prisma.payment.count as unknown as Mock;
const mockAuditCreate = prisma.auditLog.create as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;
const mockQueryRawUnsafe = prisma.$queryRawUnsafe as unknown as Mock;

const PROJECT_A = 'cmproject0000000000000000a';
const PROJECT_B = 'cmproject0000000000000000b';

const projectRow = { id: PROJECT_A, name: 'Apollo Launch', status: 'active', deletedAt: null };

const baseInvoice = {
  id: 'inv-1',
  organizationId: 'org-1',
  number: 'INV-2026-0001',
  clientId: null,
  projectId: null as string | null,
  project: null as typeof projectRow | null,
  title: 'Website Redesign',
  status: 'draft',
  subtotal: '100.00',
  tax: '10.00',
  total: '110.00',
  currency: 'USD',
  dueDate: null,
  notes: null,
  deletedAt: null as Date | null,
  createdBy: 'user-1',
  updatedBy: 'user-1',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  creator: null,
  updater: null,
  client: null,
  items: [],
  payments: [],
};

const linkedInvoice = { ...baseInvoice, projectId: PROJECT_A, project: projectRow };

const lineItems = [{ description: 'Design', quantity: '2', unitPrice: '50.00', taxRate: '10' }];
const createInput = {
  title: 'New Invoice',
  status: 'draft' as const,
  currency: 'USD',
  dueDate: null,
  notes: null,
};

const forbidden = () => Object.assign(new Error('Forbidden'), { statusCode: 403 });

/** Grant every permission except the listed codes. */
function denyPermissions(...codes: string[]) {
  mockRequirePermission.mockImplementation(async (_user: string, _org: string, code: string) => {
    if (codes.includes(code)) throw forbidden();
  });
}

const auditActions = () =>
  mockAuditCreate.mock.calls.map((call) => (call[0] as { data: { action: string } }).data.action);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({
    session: { id: 'session-1' },
    user: { id: 'user-1', email: 'user@agency.com' },
  });
  mockRequireOrganization.mockResolvedValue({ organizationId: 'org-1' });
  mockRequirePermission.mockReset();
  mockRequirePermission.mockResolvedValue(undefined);
  mockCookies.mockReturnValue({ toString: () => '' } as never);
  mockTransaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as [])
  );
  mockAllocateNumber.mockResolvedValue({ number: 'INV-2026-0001', sequence: 1, prefix: 'INV' });
  mockQueryRawUnsafe.mockResolvedValue([]);
  mockPaymentCount.mockResolvedValue(0);
  mockProjectFindFirst.mockResolvedValue({ id: PROJECT_A, status: 'active' });
});

describe('source billing tax-rate service guard', () => {
  it.each(['-0.01', '100.01', '8.251', '1e2', 'Infinity'])(
    'rejects tax rate %s before authentication, transactions, or financial writes',
    async (taxRate) => {
      await expect(
        addBillableSourcesToInvoice('invoice-id', {
          expenses: [{ id: PROJECT_A, taxRate }],
          changeOrders: [],
        } as never)
      ).rejects.toMatchObject({ statusCode: 400 });

      expect(mockGetSession).not.toHaveBeenCalled();
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(mockInvoiceUpdate).not.toHaveBeenCalled();
      expect(mockAuditCreate).not.toHaveBeenCalled();
    }
  );
});

describe('invoice schemas: projectId', () => {
  const base = { title: 'Invoice' };

  it('accepts an id, null, or no project on create', () => {
    expect(invoiceCreateSchema.safeParse({ ...base, projectId: PROJECT_A }).success).toBe(true);
    expect(invoiceCreateSchema.safeParse({ ...base, projectId: null }).success).toBe(true);
    expect(invoiceCreateSchema.safeParse(base).success).toBe(true);
  });

  it('rejects a malformed project id and a client-supplied organizationId', () => {
    expect(invoiceCreateSchema.safeParse({ ...base, projectId: "x' OR 1=1" }).success).toBe(false);
    expect(invoiceCreateSchema.safeParse({ ...base, projectId: '' }).success).toBe(false);
    expect(
      invoiceCreateSchema.safeParse({ ...base, projectId: PROJECT_A, organizationId: 'org-2' })
        .success
    ).toBe(false);
    expect(
      invoiceUpdateSchema.safeParse({ projectId: PROJECT_A, organizationId: 'org-2' }).success
    ).toBe(false);
  });

  it('treats a project-only update (including unlink) as a valid update', () => {
    expect(invoiceUpdateSchema.safeParse({ projectId: PROJECT_A }).success).toBe(true);
    expect(invoiceUpdateSchema.safeParse({ projectId: null }).success).toBe(true);
    expect(invoiceUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('never injects a currency into an update that did not send one', () => {
    // Regression: the update schema inherited the create default, so linking a
    // project to a EUR invoice (`{ projectId }`) silently rewrote it to USD.
    const parsed = invoiceUpdateSchema.parse({ projectId: PROJECT_A });
    expect(parsed).toEqual({ projectId: PROJECT_A });
    expect(invoiceUpdateSchema.parse({ currency: 'EUR' })).toEqual({ currency: 'EUR' });
    // Creation keeps its default.
    expect(invoiceCreateSchema.parse({ title: 'Invoice' }).currency).toBe('USD');
  });

  it('accepts a well-formed project filter only', () => {
    expect(invoiceQuerySchema.safeParse({ projectId: PROJECT_A }).success).toBe(true);
    expect(invoiceQuerySchema.safeParse({ projectId: 'not-a-cuid!' }).success).toBe(false);
  });
});

describe('createInvoice with a project', () => {
  beforeEach(() => {
    mockInvoiceCreate.mockResolvedValue({ id: 'inv-new' });
  });

  it('links an authorized project of the same organization', async () => {
    mockInvoiceFindUniqueOrThrow.mockResolvedValue({ ...linkedInvoice, id: 'inv-new' });

    const result = await createInvoice({ ...createInput, projectId: PROJECT_A }, lineItems);

    expect(mockRequirePermission).toHaveBeenCalledWith('user-1', 'org-1', 'invoice.create');
    expect(mockRequirePermission).toHaveBeenCalledWith('user-1', 'org-1', 'project.read');
    // Resolved inside the caller's organization, never by id alone.
    expect(mockProjectFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PROJECT_A, organizationId: 'org-1', deletedAt: null },
      })
    );
    expect(mockInvoiceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: 'org-1', projectId: PROJECT_A }),
      })
    );
    expect(result.projectId).toBe(PROJECT_A);
    expect(result.project).toEqual({
      id: PROJECT_A,
      name: 'Apollo Launch',
      status: 'active',
      deleted: false,
    });
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'invoice.create',
          after: expect.objectContaining({ projectId: PROJECT_A }),
        }),
      })
    );
  });

  it('creates a project-less invoice without touching projects or project permissions', async () => {
    mockInvoiceFindUniqueOrThrow.mockResolvedValue({ ...baseInvoice, id: 'inv-new' });

    const result = await createInvoice(createInput, lineItems);

    expect(mockProjectFindFirst).not.toHaveBeenCalled();
    expect(mockRequirePermission).not.toHaveBeenCalledWith('user-1', 'org-1', 'project.read');
    expect(mockInvoiceCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ projectId: null }) })
    );
    expect(result.projectId).toBeNull();
    expect(result.project).toBeNull();
  });

  it('keeps totals, currency and numbering identical with or without a project', async () => {
    mockInvoiceFindUniqueOrThrow.mockResolvedValue({ ...baseInvoice, id: 'inv-new' });

    await createInvoice({ ...createInput, currency: 'EUR' }, lineItems);
    await createInvoice({ ...createInput, currency: 'EUR', projectId: PROJECT_A }, lineItems);

    const [plain, linked] = mockInvoiceCreate.mock.calls.map(
      (call) => (call[0] as { data: Record<string, unknown> }).data
    );
    for (const key of ['number', 'subtotal', 'tax', 'total', 'currency', 'status']) {
      expect(linked[key]).toEqual(plain[key]);
    }
    expect(linked).toMatchObject({ subtotal: '100.00', tax: '10.00', total: '110.00' });
    expect(linked.items).toEqual(plain.items);
  });

  it('refuses to link when the caller cannot read projects, before any lookup or write', async () => {
    denyPermissions('project.read');

    await expect(
      createInvoice({ ...createInput, projectId: PROJECT_A }, lineItems)
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(mockProjectFindFirst).not.toHaveBeenCalled();
    expect(mockAllocateNumber).not.toHaveBeenCalled();
    expect(mockInvoiceCreate).not.toHaveBeenCalled();
  });

  it('answers a non-disclosing 404 for a project outside the organization (or deleted)', async () => {
    mockProjectFindFirst.mockResolvedValue(null);

    await expect(
      createInvoice({ ...createInput, projectId: PROJECT_B }, lineItems)
    ).rejects.toMatchObject({ statusCode: 404, message: 'Not found' });

    // No number is consumed and nothing is written for a rejected link.
    expect(mockAllocateNumber).not.toHaveBeenCalled();
    expect(mockInvoiceCreate).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it('rejects an archived project', async () => {
    mockProjectFindFirst.mockResolvedValue({ id: PROJECT_A, status: 'archived' });

    await expect(
      createInvoice({ ...createInput, projectId: PROJECT_A }, lineItems)
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'Cannot link an invoice to an archived project',
    });
    expect(mockInvoiceCreate).not.toHaveBeenCalled();
  });
});

describe('updateInvoice project association', () => {
  it('leaves the project alone when the field is omitted', async () => {
    mockInvoiceFindFirst.mockResolvedValue(linkedInvoice);
    mockInvoiceUpdate.mockResolvedValue({ ...linkedInvoice, title: 'Changed' });

    const result = await updateInvoice('inv-1', { title: 'Changed' });

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockProjectFindFirst).not.toHaveBeenCalled();
    const data = (mockInvoiceUpdate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty('projectId');
    expect(result.projectId).toBe(PROJECT_A);
    expect(auditActions()).toEqual(['invoice.update']);
  });

  it('treats the current project as "no change", even if it is archived by now', async () => {
    mockInvoiceFindFirst.mockResolvedValue(linkedInvoice);
    mockInvoiceUpdate.mockResolvedValue(linkedInvoice);
    mockProjectFindFirst.mockResolvedValue({ id: PROJECT_A, status: 'archived' });

    await updateInvoice('inv-1', { title: 'Changed', projectId: PROJECT_A });

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockProjectFindFirst).not.toHaveBeenCalled();
    expect(auditActions()).not.toContain('invoice.project_change');
  });

  it('links a draft invoice under the row lock and audits it in the same transaction', async () => {
    mockInvoiceFindFirst
      .mockResolvedValueOnce(baseInvoice) // initial read
      .mockResolvedValueOnce({ number: 'INV-2026-0001', status: 'draft', projectId: null }); // locked
    mockInvoiceUpdate.mockResolvedValue({ id: 'inv-1' });
    mockInvoiceFindUniqueOrThrow.mockResolvedValue(linkedInvoice);

    const result = await updateInvoice('inv-1', { projectId: PROJECT_A });

    expect(mockRequirePermission).toHaveBeenCalledWith('user-1', 'org-1', 'invoice.update');
    expect(mockRequirePermission).toHaveBeenCalledWith('user-1', 'org-1', 'project.read');
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockQueryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'), 'inv-1');
    expect(mockPaymentCount).toHaveBeenCalledWith({ where: { invoiceId: 'inv-1' } });

    const data = (mockInvoiceUpdate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.projectId).toBe(PROJECT_A);
    // Financial columns are carried over untouched by a link change.
    expect(data).toMatchObject({ subtotal: '100.00', tax: '10.00', total: '110.00' });
    expect(data).not.toHaveProperty('number');

    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'invoice.project_change',
        entityType: 'Invoice',
        entityId: 'inv-1',
        organizationId: 'org-1',
        actorId: 'user-1',
        before: { id: 'inv-1', number: 'INV-2026-0001', projectId: null },
        after: { id: 'inv-1', number: 'INV-2026-0001', projectId: PROJECT_A },
      }),
    });
    expect(result.project?.id).toBe(PROJECT_A);
  });

  it('unlinks with null without requiring project access', async () => {
    denyPermissions('project.read');
    mockInvoiceFindFirst
      .mockResolvedValueOnce(linkedInvoice)
      .mockResolvedValueOnce({ number: 'INV-2026-0001', status: 'draft', projectId: PROJECT_A });
    mockInvoiceUpdate.mockResolvedValue({ id: 'inv-1' });
    mockInvoiceFindUniqueOrThrow.mockResolvedValue(baseInvoice);

    const result = await updateInvoice('inv-1', { projectId: null });

    expect(mockProjectFindFirst).not.toHaveBeenCalled();
    const data = (mockInvoiceUpdate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.projectId).toBeNull();
    expect(auditActions()).toContain('invoice.project_change');
    expect(result.projectId).toBeNull();
  });

  it('refuses to move an invoice that has recorded payments, and writes nothing', async () => {
    mockInvoiceFindFirst
      .mockResolvedValueOnce({ ...linkedInvoice, status: 'sent' })
      .mockResolvedValueOnce({ number: 'INV-2026-0001', status: 'sent', projectId: PROJECT_A });
    mockPaymentCount.mockResolvedValue(1);
    mockProjectFindFirst.mockResolvedValue({ id: PROJECT_B, status: 'active' });

    await expect(updateInvoice('inv-1', { projectId: PROJECT_B })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Cannot change the project of an invoice that has recorded payments',
    });

    expect(mockInvoiceUpdate).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it('re-checks the status under the lock (a payment may have just completed the invoice)', async () => {
    mockInvoiceFindFirst
      .mockResolvedValueOnce({ ...baseInvoice, status: 'sent' })
      .mockResolvedValueOnce({ number: 'INV-2026-0001', status: 'paid', projectId: null });

    await expect(updateInvoice('inv-1', { projectId: PROJECT_A })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockInvoiceUpdate).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it.each(['paid', 'overdue', 'voided'])('never reassigns a %s invoice', async (status: string) => {
    mockInvoiceFindFirst.mockResolvedValue({ ...linkedInvoice, status });

    await expect(updateInvoice('inv-1', { projectId: PROJECT_B })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockProjectFindFirst).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockInvoiceUpdate).not.toHaveBeenCalled();
  });

  it('refuses to change the project of a soft-deleted invoice', async () => {
    mockInvoiceFindFirst.mockResolvedValue({ ...baseInvoice, deletedAt: new Date() });

    await expect(updateInvoice('inv-1', { projectId: PROJECT_A })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('rejects a project of another organization with 404 and one the caller cannot read with 403', async () => {
    mockInvoiceFindFirst.mockResolvedValue(baseInvoice);
    mockProjectFindFirst.mockResolvedValue(null);
    await expect(updateInvoice('inv-1', { projectId: PROJECT_B })).rejects.toMatchObject({
      statusCode: 404,
    });

    denyPermissions('project.read');
    await expect(updateInvoice('inv-1', { projectId: PROJECT_B })).rejects.toMatchObject({
      statusCode: 403,
    });

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockInvoiceUpdate).not.toHaveBeenCalled();
  });

  it('does not reveal or modify an invoice of another organization', async () => {
    mockInvoiceFindFirst.mockResolvedValue(null);

    await expect(updateInvoice('inv-other', { projectId: PROJECT_A })).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockInvoiceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'inv-other', organizationId: 'org-1' } })
    );
    expect(mockProjectFindFirst).not.toHaveBeenCalled();
  });
});

describe('reading invoices with a project', () => {
  it('combines the project filter with the organization scope', async () => {
    mockInvoiceFindMany.mockResolvedValue([linkedInvoice]);
    mockInvoiceCount.mockResolvedValue(1);

    const result = await listInvoices({
      page: 1,
      pageSize: 20,
      projectId: PROJECT_A,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      includeDeleted: false,
    });

    const where = { organizationId: 'org-1', deletedAt: null, projectId: PROJECT_A };
    expect(mockInvoiceFindMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
    expect(mockInvoiceCount).toHaveBeenCalledWith({ where });
    expect(result.invoices[0].project).toMatchObject({ id: PROJECT_A, name: 'Apollo Launch' });
  });

  it('exposes only a minimal project summary, never the project record', async () => {
    mockInvoiceFindFirst.mockResolvedValue({
      ...linkedInvoice,
      project: {
        ...projectRow,
        deletedAt: new Date(),
        // Columns the query does not select; they must never leak even if present.
        budget: '50000',
        description: 'Confidential scope',
        clientId: 'contact-9',
      },
    });

    const result = await getInvoice('inv-1');

    expect(result.project).toEqual({
      id: PROJECT_A,
      name: 'Apollo Launch',
      status: 'active',
      deleted: true,
    });
    const include = (mockInvoiceFindFirst.mock.calls[0][0] as { include: { project: unknown } })
      .include;
    expect(include.project).toEqual({
      select: { id: true, name: true, status: true, deletedAt: true },
    });
  });

  it('redacts project details for a caller without project.read', async () => {
    denyPermissions('project.read');
    mockInvoiceFindFirst.mockResolvedValue(linkedInvoice);
    mockInvoiceFindMany.mockResolvedValue([linkedInvoice, baseInvoice]);
    mockInvoiceCount.mockResolvedValue(2);

    const single = await getInvoice('inv-1');
    expect(single.projectId).toBe(PROJECT_A);
    expect(single.project).toBeNull();

    const list = await listInvoices({
      page: 1,
      pageSize: 20,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      includeDeleted: false,
    });
    expect(list.invoices.map((invoice: { project: unknown }) => invoice.project)).toEqual([
      null,
      null,
    ]);
    expect(JSON.stringify(list)).not.toContain('Apollo Launch');
  });

  it('still requires invoice.read; project access alone opens nothing', async () => {
    denyPermissions('invoice.read');

    await expect(getInvoice('inv-1')).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      listInvoices({
        page: 1,
        pageSize: 20,
        projectId: PROJECT_A,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        includeDeleted: false,
      })
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockInvoiceFindFirst).not.toHaveBeenCalled();
    expect(mockInvoiceFindMany).not.toHaveBeenCalled();
  });

  it('does not look up project permissions for project-less invoices', async () => {
    mockInvoiceFindFirst.mockResolvedValue(baseInvoice);

    await getInvoice('inv-1');

    expect(mockRequirePermission).toHaveBeenCalledTimes(1);
    expect(mockRequirePermission).toHaveBeenCalledWith('user-1', 'org-1', 'invoice.read');
  });
});
