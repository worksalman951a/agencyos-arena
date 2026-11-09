/**
 * Soft-delete filtering across every module that exposes `includeDeleted`.
 *
 * Regression: these query schemas used `z.coerce.boolean()`, so the contacts
 * list page's `?includeDeleted=false` reached the services as `true` and the
 * `deletedAt: null` filter was skipped — soft-deleted records appeared in
 * ordinary lists (and their detail pages showed a "Deleted At" date).
 *
 * These tests exercise the full chain the API uses:
 *   query string -> zod schema -> service -> prisma `where`
 * for all ten affected modules, with Prisma mocked.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { z } from 'zod';

interface RecordedCall {
  model: string;
  method: string;
  args?: Record<string, unknown>;
}

const mocks = vi.hoisted(() => {
  const calls: RecordedCall[] = [];

  function makeModel(name: string) {
    return {
      findMany: vi.fn(async (args?: Record<string, unknown>) => {
        calls.push({ model: name, method: 'findMany', args });
        return [] as unknown[];
      }),
      count: vi.fn(async (args?: Record<string, unknown>) => {
        calls.push({ model: name, method: 'count', args });
        return 0;
      }),
      findFirst: vi.fn(async (args?: Record<string, unknown>) => {
        calls.push({ model: name, method: 'findFirst', args });
        return null as unknown;
      }),
    };
  }

  const prisma = {
    contact: makeModel('contact'),
    agencyAccount: makeModel('agencyAccount'),
    lead: makeModel('lead'),
    opportunity: makeModel('opportunity'),
    pipeline: makeModel('pipeline'),
    pipelineStage: makeModel('pipelineStage'),
    proposal: makeModel('proposal'),
    quotation: makeModel('quotation'),
    invoice: makeModel('invoice'),
    project: makeModel('project'),
    $transaction: vi.fn(async (operations: unknown) =>
      Promise.all(operations as Array<Promise<unknown>>)
    ),
  };

  return { calls, prisma };
});

vi.mock('@/lib/db', () => ({ prisma: mocks.prisma, default: mocks.prisma }));

vi.mock('@/lib/auth-server', () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => ({
        session: { id: 'session_1' },
        user: {
          id: 'user_1',
          email: 'user@example.com',
          organizationId: 'org_1',
          role: 'admin',
        },
      })),
    },
  },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ toString: (): string => 'better-auth.session_token=test' })),
}));

vi.mock('@/lib/permissions', () => ({
  requirePermission: vi.fn(async () => undefined),
  requireOrganization: vi.fn(async () => ({ userId: 'user_1', organizationId: 'org_1' })),
  hasPermission: vi.fn(async () => true),
  getUserPermissions: vi.fn(async () => new Set<string>()),
}));

import { listAccounts } from '@/lib/services/crm/account-service';
import { listContacts } from '@/lib/services/crm/contact-service';
import { listLeads } from '@/lib/services/crm/lead-service';
import { listOpportunities } from '@/lib/services/crm/opportunity-service';
import { listPipelines } from '@/lib/services/crm/pipeline-service';
import { listPipelineStages } from '@/lib/services/crm/pipeline-stage-service';
import { listProposals } from '@/lib/services/crm/proposal-service';
import { listQuotations } from '@/lib/services/crm/quotation-service';
import { listInvoices } from '@/lib/services/crm/invoice-service';
import { listProjects } from '@/lib/services/crm/project-service';

import { accountQuerySchema } from '@/lib/schemas/crm/account.schema';
import { contactQuerySchema } from '@/lib/schemas/crm/contact.schema';
import { leadQuerySchema } from '@/lib/schemas/crm/lead.schema';
import { opportunityQuerySchema } from '@/lib/schemas/crm/opportunity.schema';
import { pipelineQuerySchema } from '@/lib/schemas/crm/pipeline.schema';
import { pipelineStageQuerySchema } from '@/lib/schemas/crm/pipeline-stage.schema';
import { proposalQuerySchema } from '@/lib/schemas/crm/proposal.schema';
import { quotationQuerySchema } from '@/lib/schemas/crm/quotation.schema';
import { invoiceQuerySchema } from '@/lib/schemas/crm/invoice.schema';
import { projectQuerySchema } from '@/lib/schemas/crm/project.schema';

interface ServiceCase {
  name: string;
  /** Prisma model backing the list query. */
  model: string;
  schema: z.ZodType<Record<string, unknown>>;
  /** Invoke the service the way its API route does. */
  run: (input: never) => Promise<unknown>;
  /** Whether the service scopes its list query by organization. */
  organizationScoped: boolean;
  /** Extra arrangement needed before calling (e.g. parent pipeline lookup). */
  arrange?: () => void;
}

const services: ServiceCase[] = [
  {
    name: 'accounts',
    model: 'agencyAccount',
    schema: accountQuerySchema as unknown as z.ZodType<Record<string, unknown>>,
    run: (input) => listAccounts(input),
    organizationScoped: true,
  },
  {
    name: 'contacts',
    model: 'contact',
    schema: contactQuerySchema as unknown as z.ZodType<Record<string, unknown>>,
    run: (input) => listContacts(input),
    organizationScoped: true,
  },
  {
    name: 'leads',
    model: 'lead',
    schema: leadQuerySchema as unknown as z.ZodType<Record<string, unknown>>,
    run: (input) => listLeads(input),
    organizationScoped: true,
  },
  {
    name: 'opportunities',
    model: 'opportunity',
    schema: opportunityQuerySchema as unknown as z.ZodType<Record<string, unknown>>,
    run: (input) => listOpportunities(input),
    organizationScoped: true,
  },
  {
    name: 'pipelines',
    model: 'pipeline',
    schema: pipelineQuerySchema as unknown as z.ZodType<Record<string, unknown>>,
    run: (input) => listPipelines(input),
    organizationScoped: true,
  },
  {
    name: 'pipeline stages',
    model: 'pipelineStage',
    schema: pipelineStageQuerySchema as unknown as z.ZodType<Record<string, unknown>>,
    run: (input) => listPipelineStages('pipeline_1', input),
    // Stages inherit tenancy from their pipeline; the pipeline is validated
    // against the caller's organization before the stage query runs.
    organizationScoped: false,
    arrange: () => {
      mocks.prisma.pipeline.findFirst.mockResolvedValueOnce({
        id: 'pipeline_1',
        organizationId: 'org_1',
      });
    },
  },
  {
    name: 'proposals',
    model: 'proposal',
    schema: proposalQuerySchema as unknown as z.ZodType<Record<string, unknown>>,
    run: (input) => listProposals(input),
    organizationScoped: true,
  },
  {
    name: 'quotations',
    model: 'quotation',
    schema: quotationQuerySchema as unknown as z.ZodType<Record<string, unknown>>,
    run: (input) => listQuotations(input),
    organizationScoped: true,
  },
  {
    name: 'invoices',
    model: 'invoice',
    schema: invoiceQuerySchema as unknown as z.ZodType<Record<string, unknown>>,
    run: (input) => listInvoices(input),
    organizationScoped: true,
  },
  {
    name: 'projects',
    model: 'project',
    schema: projectQuerySchema as unknown as z.ZodType<Record<string, unknown>>,
    run: (input) => listProjects(input),
    organizationScoped: true,
  },
];

/** `where` of the most recent list query for a model. */
function listWhere(model: string): Record<string, unknown> | undefined {
  const call = [...mocks.calls]
    .reverse()
    .find((entry) => entry.model === model && entry.method === 'findMany');
  return call?.args?.where as Record<string, unknown> | undefined;
}

describe.each(services)('$name list', (service) => {
  beforeEach(() => {
    mocks.calls.length = 0;
    service.arrange?.();
  });

  it('excludes soft-deleted records when includeDeleted is omitted', async () => {
    await service.run(service.schema.parse({}) as never);

    expect(listWhere(service.model)).toMatchObject({ deletedAt: null });
  });

  it('excludes soft-deleted records for includeDeleted=false (reported bug)', async () => {
    await service.run(service.schema.parse({ includeDeleted: 'false' }) as never);

    expect(listWhere(service.model)).toMatchObject({ deletedAt: null });
  });

  it('excludes soft-deleted records for includeDeleted=0', async () => {
    await service.run(service.schema.parse({ includeDeleted: '0' }) as never);

    expect(listWhere(service.model)).toMatchObject({ deletedAt: null });
  });

  it('includes soft-deleted records only when includeDeleted=true', async () => {
    await service.run(service.schema.parse({ includeDeleted: 'true' }) as never);

    const where = listWhere(service.model);
    expect(where).toBeDefined();
    expect(where).not.toHaveProperty('deletedAt');
  });

  it('includes soft-deleted records only when includeDeleted=1', async () => {
    await service.run(service.schema.parse({ includeDeleted: '1' }) as never);

    expect(listWhere(service.model)).not.toHaveProperty('deletedAt');
  });

  it('counts with the same soft-delete filter as the page of rows', async () => {
    await service.run(service.schema.parse({ includeDeleted: 'false' }) as never);

    const countCall = [...mocks.calls]
      .reverse()
      .find((entry) => entry.model === service.model && entry.method === 'count');
    const countWhere = countCall?.args?.where as Record<string, unknown> | undefined;

    expect(countWhere).toMatchObject({ deletedAt: null });
    expect(countWhere).toEqual(listWhere(service.model));
  });

  it.runIf(service.organizationScoped)('keeps the organization filter', async () => {
    await service.run(service.schema.parse({ includeDeleted: 'false' }) as never);

    expect(listWhere(service.model)).toMatchObject({ organizationId: 'org_1' });
  });

  it('rejects an invalid includeDeleted token instead of listing deleted records', () => {
    expect(() => service.schema.parse({ includeDeleted: 'maybe' })).toThrow();
  });
});
