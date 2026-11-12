// @vitest-environment node
/**
 * Integration: project-to-invoice linking (Phase 5A, real PostgreSQL).
 *
 * Exercises migration `0021_invoice_project_link` and the invoice/project
 * services end to end, over the real HTTP endpoints and directly against the
 * database:
 *
 *   1. an invoice can be created linked to an authorized project;
 *   2. an invoice can still be created without a project;
 *   3. one project can own several invoices;
 *   4. a cross-organization link is rejected by the API *and* by PostgreSQL;
 *   5. unauthenticated, under-privileged and foreign-tenant callers get nothing;
 *   6. unknown, malformed, soft-deleted and archived projects are refused;
 *   7. invoices can be filtered by project, inside the caller's organization;
 *   8. the project workspace hands off to the existing new-invoice page;
 *   9. the link follows the invoice lifecycle (no reassignment after payment);
 *  10. payments, idempotency, currencies, totals and numbering are unchanged;
 *  11. the migration is additive and compatible with pre-existing invoices.
 *
 * Requires DATABASE_URL and a running server; skips otherwise.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';
import {
  authHeaders,
  cleanupOrganizations,
  createBootstrappedAccount,
  createMemberWithPermissions,
  createOrganizationWithAdmin,
  jsonFetch,
  sessionFor,
  type TestAccount,
} from './batch4-provisioning';
import { SERVER_URL } from './test-config';

const canRun = Boolean(process.env.DATABASE_URL);
const describeIfDb = canRun ? describe : describe.skip;

const FK_NAME = 'Invoice_projectId_organizationId_fkey';

interface ProjectSummary {
  id: string;
  name: string;
  status: string;
  deleted: boolean;
}

interface InvoiceBody {
  id: string;
  number: string;
  title: string;
  status: string;
  subtotal: string;
  tax: string;
  total: string;
  currency: string;
  projectId: string | null;
  project: ProjectSummary | null;
  payments: Array<{ id: string; amount: string }>;
}

interface InvoiceList {
  invoices: InvoiceBody[];
  total: number;
}

const LINE = [{ description: 'Work', quantity: '2', unitPrice: '150.00', taxRate: '10' }];

/** Trailing sequence of an invoice number ("INV-0007" -> 7). */
const sequenceOf = (number: string) => Number(/(\d+)$/.exec(number)?.[1]);

describeIfDb('Project-to-invoice linking (real PostgreSQL)', () => {
  const createdOrganizations: string[] = [];

  let admin: TestAccount; // organization A, every permission
  let foreign: TestAccount; // organization B, every permission
  let financeOnly: TestAccount; // organization A: invoices, but no project.read
  let projectOnly: TestAccount; // organization A: projects, but no invoice access

  let projectA = '';
  let projectA2 = '';
  let archivedProject = '';
  let deletedProject = '';
  let foreignProject = '';

  const api = (
    account: TestAccount | null,
    path: string,
    init: { method?: string; body?: unknown } = {}
  ) =>
    jsonFetch(path, {
      method: init.method ?? 'GET',
      headers: account
        ? authHeaders(account.token)
        : { 'Content-Type': 'application/json', Accept: 'application/json', Origin: SERVER_URL },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

  const createProject = async (account: TestAccount, name: string, status = 'active') => {
    const res = await api(account, '/api/v1/crm/projects', {
      method: 'POST',
      body: { name, status },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return (res.body as { id: string }).id;
  };

  const postInvoice = (account: TestAccount | null, body: Record<string, unknown>) =>
    api(account, '/api/v1/crm/invoices', {
      method: 'POST',
      body: { title: 'Linked invoice', currency: 'USD', lineItems: LINE, ...body },
    });

  const createInvoice = async (body: Record<string, unknown> = {}) => {
    const res = await postInvoice(admin, body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as InvoiceBody;
  };

  const putInvoice = (account: TestAccount | null, id: string, body: Record<string, unknown>) =>
    api(account, `/api/v1/crm/invoices/${id}`, { method: 'PUT', body });

  const getInvoice = async (account: TestAccount, id: string) => {
    const res = await api(account, `/api/v1/crm/invoices/${id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as InvoiceBody;
  };

  const pay = (id: string, body: Record<string, unknown>) =>
    api(admin, `/api/v1/crm/invoices/${id}/payments`, {
      method: 'POST',
      body: { method: 'bank_transfer', ...body },
    });

  const storedProjectId = async (id: string) =>
    (
      (await prisma.invoice.findUniqueOrThrow({
        where: { id },
        select: { projectId: true },
      })) as { projectId: string | null }
    ).projectId;

  const projectChangeAudits = (id: string) =>
    prisma.auditLog.findMany({
      where: { entityType: 'Invoice', entityId: id, action: 'invoice.project_change' },
      orderBy: { createdAt: 'asc' },
    }) as Promise<
      Array<{
        actorId: string;
        organizationId: string;
        before: { projectId: string | null };
        after: { projectId: string | null };
      }>
    >;

  const invoiceCount = (organizationId: string) =>
    prisma.invoice.count({ where: { organizationId } }) as Promise<number>;

  beforeAll(async () => {
    await prisma.$connect();

    admin = await createBootstrappedAccount('project-invoices');
    createdOrganizations.push(admin.organizationId);
    foreign = await createOrganizationWithAdmin('project-invoices-foreign');
    createdOrganizations.push(foreign.organizationId);

    financeOnly = await createMemberWithPermissions(admin.organizationId, 'finance-only', [
      'invoice.read',
      'invoice.create',
      'invoice.update',
    ]);
    projectOnly = await createMemberWithPermissions(admin.organizationId, 'project-only', [
      'project.read',
    ]);

    projectA = await createProject(admin, 'Apollo Launch');
    projectA2 = await createProject(admin, 'Brand Refresh');
    archivedProject = await createProject(admin, 'Archived Engagement', 'archived');
    deletedProject = await createProject(admin, 'Deleted Engagement');
    const removed = await api(admin, `/api/v1/crm/projects/${deletedProject}`, {
      method: 'DELETE',
    });
    expect(removed.status).toBe(200);
    foreignProject = await createProject(foreign, 'Foreign Confidential Project');
  });

  afterAll(async () => {
    // Deleting the organizations cascades to their projects and invoices; the
    // NO ACTION project link must not get in the way (asserted below as well).
    await cleanupOrganizations(createdOrganizations);
    await prisma.user
      .deleteMany({
        where: {
          id: {
            in: [admin, foreign, financeOnly, projectOnly]
              .map((account) => account?.userId)
              .filter(Boolean),
          },
        },
      })
      .catch(() => {});
    await prisma.$disconnect();
  });

  // -------------------------------------------------------------------------
  // 1-3. Creating linked and unlinked invoices
  // -------------------------------------------------------------------------

  describe('creating invoices', () => {
    it('creates an invoice linked to an authorized project', async () => {
      const invoice = await createInvoice({ projectId: projectA, title: 'Apollo deposit' });

      expect(invoice.projectId).toBe(projectA);
      expect(invoice.project).toEqual({
        id: projectA,
        name: 'Apollo Launch',
        status: 'active',
        deleted: false,
      });

      const row = (await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })) as {
        projectId: string | null;
        organizationId: string;
      };
      expect(row.projectId).toBe(projectA);
      // The organization comes from the session, never from the request.
      expect(row.organizationId).toBe(admin.organizationId);

      const audit = (await prisma.auditLog.findFirst({
        where: { entityType: 'Invoice', entityId: invoice.id, action: 'invoice.create' },
      })) as { after: { projectId: string | null } } | null;
      expect(audit?.after.projectId).toBe(projectA);

      expect((await getInvoice(admin, invoice.id)).project?.name).toBe('Apollo Launch');
    });

    it('creates an invoice without a project (omitted or null)', async () => {
      const omitted = await createInvoice({ title: 'No project' });
      const explicit = await createInvoice({ title: 'Null project', projectId: null });

      for (const invoice of [omitted, explicit]) {
        expect(invoice.projectId).toBeNull();
        expect(invoice.project).toBeNull();
        expect(await storedProjectId(invoice.id)).toBeNull();
      }
    });

    it('lets one project own several invoices', async () => {
      const project = await createProject(admin, 'Multi-invoice Project');
      const invoices = [
        await createInvoice({ projectId: project, title: 'Phase 1' }),
        await createInvoice({ projectId: project, title: 'Phase 2', currency: 'EUR' }),
        await createInvoice({ projectId: project, title: 'Phase 3' }),
      ];

      expect(new Set(invoices.map((i) => i.number)).size).toBe(3);
      const stored = await prisma.invoice.count({ where: { projectId: project } });
      expect(stored).toBe(3);

      const listed = await api(admin, `/api/v1/crm/invoices?projectId=${project}`);
      expect((listed.body as InvoiceList).total).toBe(3);
    });

    it('rejects a client-supplied organizationId instead of trusting it', async () => {
      const before = await invoiceCount(foreign.organizationId);
      const res = await postInvoice(admin, {
        projectId: projectA,
        organizationId: foreign.organizationId,
      });

      expect(res.status).toBe(400); // strict schema: unknown key rejected
      expect(await invoiceCount(foreign.organizationId)).toBe(before);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Cross-organization association
  // -------------------------------------------------------------------------

  describe('cross-organization association', () => {
    it('rejects creating an invoice for a project of another organization', async () => {
      const before = await invoiceCount(admin.organizationId);
      const previous = await createInvoice({ title: 'Before rejected link' });

      const res = await postInvoice(admin, { projectId: foreignProject });

      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('Foreign Confidential');
      // Nothing was written, and the rejected attempt consumed no invoice number.
      expect(await invoiceCount(admin.organizationId)).toBe(before + 1);
      const next = await createInvoice({ title: 'After rejected link' });
      expect(sequenceOf(next.number)).toBe(sequenceOf(previous.number) + 1);
    });

    it('rejects re-pointing an existing invoice to a foreign project', async () => {
      const invoice = await createInvoice({ projectId: projectA });

      const res = await putInvoice(admin, invoice.id, { projectId: foreignProject });

      expect(res.status).toBe(404);
      expect(await storedProjectId(invoice.id)).toBe(projectA);
      expect(await projectChangeAudits(invoice.id)).toHaveLength(0);
    });

    it('is enforced by PostgreSQL itself, whoever writes the row', async () => {
      // Direct writes bypass every service check; only the composite FK is left.
      await expect(
        prisma.invoice.create({
          data: {
            organizationId: admin.organizationId,
            number: `XORG-${Date.now()}`,
            title: 'Cross-tenant insert',
            projectId: foreignProject,
          },
        })
      ).rejects.toMatchObject({ code: 'P2003' });

      const invoice = await createInvoice({ title: 'Cross-tenant update target' });
      await expect(
        prisma.invoice.update({ where: { id: invoice.id }, data: { projectId: foreignProject } })
      ).rejects.toMatchObject({ code: 'P2003' });

      await expect(
        prisma.$executeRawUnsafe(
          'UPDATE "Invoice" SET "projectId" = $1 WHERE id = $2',
          foreignProject,
          invoice.id
        )
      ).rejects.toThrow(new RegExp(`${FK_NAME}|23503`));

      // A project id that does not exist at all is refused the same way.
      await expect(
        prisma.invoice.update({ where: { id: invoice.id }, data: { projectId: 'no-such-project' } })
      ).rejects.toMatchObject({ code: 'P2003' });

      expect(await storedProjectId(invoice.id)).toBeNull();
    });

    it('cannot be bypassed by moving the project or the invoice to another organization', async () => {
      const project = await createProject(admin, 'Pinned Project');
      const invoice = await createInvoice({ projectId: project });

      await expect(
        prisma.$executeRawUnsafe(
          'UPDATE "Project" SET "organizationId" = $1 WHERE id = $2',
          foreign.organizationId,
          project
        )
      ).rejects.toThrow(new RegExp(`${FK_NAME}|23503`));

      await expect(
        prisma.$executeRawUnsafe(
          'UPDATE "Invoice" SET "organizationId" = $1 WHERE id = $2',
          foreign.organizationId,
          invoice.id
        )
      ).rejects.toThrow(new RegExp(`${FK_NAME}|23503`));

      const row = (await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })) as {
        organizationId: string;
        projectId: string | null;
      };
      expect(row).toMatchObject({ organizationId: admin.organizationId, projectId: project });
    });
  });

  // -------------------------------------------------------------------------
  // 5. Unauthorized access
  // -------------------------------------------------------------------------

  describe('unauthorized project/invoice access', () => {
    let linked: InvoiceBody;

    beforeAll(async () => {
      linked = await createInvoice({ projectId: projectA, title: 'Access-control target' });
    });

    it('rejects unauthenticated callers', async () => {
      expect((await postInvoice(null, { projectId: projectA })).status).toBe(401);
      expect((await api(null, `/api/v1/crm/invoices?projectId=${projectA}`)).status).toBe(401);
      expect((await api(null, `/api/v1/crm/invoices/${linked.id}`)).status).toBe(401);
      expect((await putInvoice(null, linked.id, { projectId: null })).status).toBe(401);
      expect(await storedProjectId(linked.id)).toBe(projectA);
    });

    it('does not let a member without project.read attach invoices to projects', async () => {
      const before = await invoiceCount(admin.organizationId);

      const denied = await postInvoice(financeOnly, { projectId: projectA });
      expect(denied.status).toBe(403);
      // Same answer for a project that does not exist: no existence oracle.
      const unknown = await postInvoice(financeOnly, { projectId: foreignProject });
      expect(unknown.status).toBe(403);
      expect(await invoiceCount(admin.organizationId)).toBe(before);

      const unlinked = await postInvoice(financeOnly, { title: 'Finance-only invoice' });
      expect(unlinked.status).toBe(201);
      const own = unlinked.body as InvoiceBody;

      const relink = await putInvoice(financeOnly, own.id, { projectId: projectA });
      expect(relink.status).toBe(403);
      expect(await storedProjectId(own.id)).toBeNull();
    });

    it('hides project details from invoice readers who cannot read projects', async () => {
      const single = await getInvoice(financeOnly, linked.id);
      expect(single.projectId).toBe(projectA);
      expect(single.project).toBeNull();
      expect(JSON.stringify(single)).not.toContain('Apollo Launch');

      const list = await api(financeOnly, `/api/v1/crm/invoices?projectId=${projectA}`);
      expect(list.status).toBe(200);
      expect((list.body as InvoiceList).total).toBeGreaterThan(0);
      expect(JSON.stringify(list.body)).not.toContain('Apollo Launch');

      // The same listing shows the summary to a caller who may read projects.
      const full = await api(admin, `/api/v1/crm/invoices?projectId=${projectA}`);
      expect(JSON.stringify(full.body)).toContain('Apollo Launch');
    });

    it('does not open invoices to a member who can only read projects', async () => {
      expect((await api(projectOnly, `/api/v1/crm/invoices?projectId=${projectA}`)).status).toBe(
        403
      );
      expect((await api(projectOnly, `/api/v1/crm/invoices/${linked.id}`)).status).toBe(403);
      expect((await postInvoice(projectOnly, { projectId: projectA })).status).toBe(403);
      expect((await putInvoice(projectOnly, linked.id, { projectId: null })).status).toBe(403);
      expect(await storedProjectId(linked.id)).toBe(projectA);
    });

    it('gives another tenant nothing for guessed project or invoice ids', async () => {
      // Filtering by our project id from their organization matches nothing.
      const list = await api(foreign, `/api/v1/crm/invoices?projectId=${projectA}`);
      expect(list.status).toBe(200);
      expect(list.body as InvoiceList).toMatchObject({ invoices: [], total: 0 });

      expect((await api(foreign, `/api/v1/crm/invoices/${linked.id}`)).status).toBe(404);
      expect((await putInvoice(foreign, linked.id, { projectId: foreignProject })).status).toBe(
        404
      );
      expect((await putInvoice(foreign, linked.id, { projectId: null })).status).toBe(404);

      // They cannot bill our project either.
      const before = await invoiceCount(foreign.organizationId);
      expect((await postInvoice(foreign, { projectId: projectA })).status).toBe(404);
      expect(await invoiceCount(foreign.organizationId)).toBe(before);

      expect(await storedProjectId(linked.id)).toBe(projectA);
    });

    it('keeps third-party project/client mismatch isolated across finance-only API and portal views', async () => {
      const contactA = (await prisma.contact.create({
        data: {
          organizationId: admin.organizationId,
          firstName: 'Alice',
          lastName: 'ProjectOwner',
          email: `alice-mismatch-${Date.now()}@integration.invalid`,
        },
      })) as { id: string };
      const contactB = (await prisma.contact.create({
        data: {
          organizationId: admin.organizationId,
          firstName: 'Bob',
          lastName: 'ThirdPartyPayer',
          email: `bob-mismatch-${Date.now()}@integration.invalid`,
        },
      })) as { id: string };

      const projRes = await api(admin, '/api/v1/crm/projects', {
        method: 'POST',
        body: {
          name: 'Secret Client A Project',
          clientId: contactA.id,
          status: 'active',
        },
      });
      expect(projRes.status).toBe(201);
      const clientAProjectId = (projRes.body as { id: string }).id;

      const inv = await createInvoice({
        projectId: clientAProjectId,
        clientId: contactB.id,
        title: 'Third Party Sponsor Invoice',
      });

      // 1. Finance-only member (no project.read) sees invoice's clientB without project or clientA
      const financeView = await getInvoice(financeOnly, inv.id);
      expect(financeView.project).toBeNull();
      expect(JSON.stringify(financeView)).not.toContain('Secret Client A Project');
      expect(JSON.stringify(financeView)).not.toContain('ProjectOwner');
      expect(JSON.stringify(financeView)).not.toContain(contactA.id);

      // 2. Portal Client A (granted project) and Portal Client B (granted invoice) remain isolated
      const clientAUser = (await prisma.user.create({
        data: {
          email: `portal-a-${Date.now()}@integration.invalid`,
          name: 'Alice Portal',
          organizationId: admin.organizationId,
          userType: 'client',
          status: 'active',
        },
      })) as { id: string };
      const clientBUser = (await prisma.user.create({
        data: {
          email: `portal-b-${Date.now()}@integration.invalid`,
          name: 'Bob Portal',
          organizationId: admin.organizationId,
          userType: 'client',
          status: 'active',
        },
      })) as { id: string };

      const accessA = (await prisma.clientAccess.create({
        data: {
          organizationId: admin.organizationId,
          userId: clientAUser.id,
          contactId: contactA.id,
          canViewInvoices: true,
        },
      })) as { id: string };
      const accessB = (await prisma.clientAccess.create({
        data: {
          organizationId: admin.organizationId,
          userId: clientBUser.id,
          contactId: contactB.id,
          canViewInvoices: true,
        },
      })) as { id: string };

      await prisma.clientResourceGrant.createMany({
        data: [
          {
            organizationId: admin.organizationId,
            clientAccessId: accessA.id,
            resourceType: 'project',
            resourceId: clientAProjectId,
          },
          {
            organizationId: admin.organizationId,
            clientAccessId: accessB.id,
            resourceType: 'invoice',
            resourceId: inv.id,
          },
        ],
      });

      const [tokenA, tokenB] = await Promise.all([
        sessionFor(clientAUser.id),
        sessionFor(clientBUser.id),
      ]);

      const portalProjectRes = await fetch(`${SERVER_URL}/portal/projects/${clientAProjectId}`, {
        headers: { Cookie: `better-auth.session_token=${tokenA}` },
      });
      const portalProjectHtml = await portalProjectRes.text();
      expect(portalProjectRes.status).toBe(200);
      expect(portalProjectHtml).toContain('Secret Client A Project');
      expect(portalProjectHtml).not.toContain(inv.number);
      expect(portalProjectHtml).not.toContain('Third Party Sponsor Invoice');
      expect(portalProjectHtml).not.toContain('ThirdPartyPayer');

      const portalInvoicesRes = await fetch(`${SERVER_URL}/portal/invoices`, {
        headers: { Cookie: `better-auth.session_token=${tokenB}` },
      });
      const portalInvoicesHtml = await portalInvoicesRes.text();
      expect(portalInvoicesRes.status).toBe(200);
      expect(portalInvoicesHtml).toContain(inv.number);
      expect(portalInvoicesHtml).not.toContain('Secret Client A Project');
      expect(portalInvoicesHtml).not.toContain('ProjectOwner');
    });
  });

  // -------------------------------------------------------------------------
  // 6. Invalid / archived projects
  // -------------------------------------------------------------------------

  describe('invalid or archived projects', () => {
    it('rejects malformed, unknown, soft-deleted and archived projects', async () => {
      const before = await invoiceCount(admin.organizationId);

      expect((await postInvoice(admin, { projectId: 'not-a-project-id' })).status).toBe(400);
      expect((await postInvoice(admin, { projectId: '' })).status).toBe(400);
      expect((await postInvoice(admin, { projectId: 'cmzzzzzzzzzzzzzzzzzzzzzzzz' })).status).toBe(
        404
      );
      expect((await postInvoice(admin, { projectId: deletedProject })).status).toBe(404);

      const archived = await postInvoice(admin, { projectId: archivedProject });
      expect(archived.status).toBe(400);
      expect((archived.body as { error: string }).error).toBe(
        'Cannot link an invoice to an archived project'
      );

      expect(await invoiceCount(admin.organizationId)).toBe(before);
    });

    it('refuses to move an existing invoice onto an archived or deleted project', async () => {
      const invoice = await createInvoice({ projectId: projectA });

      expect((await putInvoice(admin, invoice.id, { projectId: archivedProject })).status).toBe(
        400
      );
      expect((await putInvoice(admin, invoice.id, { projectId: deletedProject })).status).toBe(404);
      expect(await storedProjectId(invoice.id)).toBe(projectA);
    });

    it('accepts projects that are on hold or completed', async () => {
      const completed = await createProject(admin, 'Completed Project', 'completed');
      const invoice = await createInvoice({ projectId: completed, title: 'Final invoice' });
      expect(invoice.project?.status).toBe('completed');
    });

    it('keeps existing invoices linked, readable and editable when their project is archived or deleted', async () => {
      const project = await createProject(admin, 'Soon Archived');
      const invoice = await createInvoice({ projectId: project, title: 'Before archive' });

      const archive = await api(admin, `/api/v1/crm/projects/${project}`, {
        method: 'PUT',
        body: { status: 'archived' },
      });
      expect(archive.status).toBe(200);

      expect((await getInvoice(admin, invoice.id)).project).toMatchObject({
        id: project,
        status: 'archived',
        deleted: false,
      });
      // Editing the invoice (re-sending its current project) still works...
      const edit = await putInvoice(admin, invoice.id, {
        title: 'After archive',
        projectId: project,
      });
      expect(edit.status, JSON.stringify(edit.body)).toBe(200);
      // ...but no new invoice can be raised against the archived project.
      expect((await postInvoice(admin, { projectId: project })).status).toBe(400);

      // Soft-deleting the project never deletes or detaches its invoices.
      const remove = await api(admin, `/api/v1/crm/projects/${project}`, { method: 'DELETE' });
      expect(remove.status).toBe(200);
      const after = await getInvoice(admin, invoice.id);
      expect(after.projectId).toBe(project);
      expect(after.project?.deleted).toBe(true);
      expect(after.total).toBe(invoice.total);
    });

    it('blocks a hard delete of a project that still has invoices, and never cascades', async () => {
      const project = await createProject(admin, 'Undeletable Project');
      const invoice = await createInvoice({ projectId: project });
      await pay(invoice.id, { amount: '10.00' });

      await expect(prisma.project.delete({ where: { id: project } })).rejects.toMatchObject({
        code: 'P2003',
      });

      expect(await prisma.project.count({ where: { id: project } })).toBe(1);
      expect(await storedProjectId(invoice.id)).toBe(project);
      expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(1);

      // A project without invoices can still be removed.
      const empty = await createProject(admin, 'Empty Project');
      await prisma.project.delete({ where: { id: empty } });
    });
  });

  // -------------------------------------------------------------------------
  // 7. Filtering
  // -------------------------------------------------------------------------

  describe('filtering invoices by project', () => {
    it('returns exactly the invoices of the requested project', async () => {
      const first = await createProject(admin, 'Filter One');
      const second = await createProject(admin, 'Filter Two');
      const a = await createInvoice({ projectId: first, title: 'Filter F1 draft' });
      const b = await createInvoice({ projectId: first, title: 'Filter F1 sent', status: 'sent' });
      const c = await createInvoice({ projectId: second, title: 'Filter F2 draft' });
      const unlinked = await createInvoice({ title: 'Filter unlinked' });

      const one = (await api(admin, `/api/v1/crm/invoices?projectId=${first}`)).body as InvoiceList;
      expect(one.total).toBe(2);
      expect(one.invoices.map((i) => i.id).sort()).toEqual([a.id, b.id].sort());
      expect(one.invoices.every((i) => i.projectId === first)).toBe(true);

      const two = (await api(admin, `/api/v1/crm/invoices?projectId=${second}`))
        .body as InvoiceList;
      expect(two.invoices.map((i) => i.id)).toEqual([c.id]);

      // Combines with the existing filters.
      const sent = (await api(admin, `/api/v1/crm/invoices?projectId=${first}&status=sent`))
        .body as InvoiceList;
      expect(sent.invoices.map((i) => i.id)).toEqual([b.id]);

      // Without the filter the listing is unchanged: unlinked invoices included.
      const all = (await api(admin, '/api/v1/crm/invoices?pageSize=100&search=Filter'))
        .body as InvoiceList;
      expect(all.invoices.map((i) => i.id)).toEqual(
        expect.arrayContaining([a.id, b.id, c.id, unlinked.id])
      );
    });

    it('answers an empty page for unknown projects and 400 for malformed ids', async () => {
      const unknown = await api(admin, '/api/v1/crm/invoices?projectId=cmzzzzzzzzzzzzzzzzzzzzzzzz');
      expect(unknown.status).toBe(200);
      expect(unknown.body as InvoiceList).toMatchObject({ invoices: [], total: 0 });

      const foreignFilter = await api(admin, `/api/v1/crm/invoices?projectId=${foreignProject}`);
      expect(foreignFilter.body as InvoiceList).toMatchObject({ invoices: [], total: 0 });

      expect((await api(admin, "/api/v1/crm/invoices?projectId=' OR 1=1 --")).status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // 8. Project -> invoice handoff
  // -------------------------------------------------------------------------

  describe('project-to-invoice creation handoff', () => {
    const page = async (account: TestAccount, path: string) => {
      const res = await fetch(`${SERVER_URL}${path}`, {
        headers: { Cookie: `better-auth.session_token=${account.token}`, Accept: 'text/html' },
        redirect: 'manual',
      });
      return { status: res.status, html: await res.text() };
    };

    it('offers the handoff from the project workspace and preselects the project', async () => {
      const project = await createProject(admin, 'Handoff Project');

      const workspace = await page(admin, `/projects/${project}`);
      expect(workspace.status).toBe(200);
      expect(workspace.html).toContain(`/finance/invoices/new?projectId=${project}`);
      expect(workspace.html).toContain('No invoices linked to this project yet.');

      const form = await page(admin, `/finance/invoices/new?projectId=${project}`);
      expect(form.status).toBe(200);
      expect(form.html).toContain('data-testid="invoice-project-handoff"');
      expect(form.html).not.toContain('data-testid="invoice-project-unavailable"');
      expect(form.html).toMatch(new RegExp(`<option value="${project}" selected`));

      // The form posts to the one invoice API; afterwards the workspace lists it.
      const invoice = await createInvoice({ projectId: project, title: 'Handoff invoice' });
      const after = await page(admin, `/projects/${project}`);
      expect(after.html).toContain(invoice.number);
      expect(after.html).toContain(`/finance/invoices?projectId=${project}`);

      const detail = await page(admin, `/finance/invoices/${invoice.id}`);
      expect(detail.html).toContain('Handoff Project');
      expect(detail.html).toContain(`/projects/${project}`);
    });

    it('never preselects (or names) a foreign, archived or deleted project', async () => {
      for (const id of [foreignProject, archivedProject, deletedProject, 'garbage']) {
        const form = await page(admin, `/finance/invoices/new?projectId=${id}`);
        expect(form.status).toBe(200);
        expect(form.html).toContain('data-testid="invoice-project-unavailable"');
        expect(form.html).not.toContain('data-testid="invoice-project-handoff"');
        expect(form.html).not.toContain(`<option value="${id}"`);
        expect(form.html).not.toContain('Foreign Confidential Project');
      }
    });

    it('does not offer the handoff for an archived project or to a member without invoice.create', async () => {
      const archived = await page(admin, `/projects/${archivedProject}`);
      expect(archived.status).toBe(200);
      expect(archived.html).not.toContain('/finance/invoices/new?projectId=');

      // project.read only: the workspace renders, with no invoice section at all.
      const restricted = await page(projectOnly, `/projects/${projectA}`);
      expect(restricted.status).toBe(200);
      expect(restricted.html).toContain('Apollo Launch');
      expect(restricted.html).not.toContain('data-testid="project-invoices"');
      expect(restricted.html).not.toContain('/finance/invoices/new?projectId=');
    });

    it('does not reveal a project name on the form to a member without project.read', async () => {
      const form = await page(financeOnly, `/finance/invoices/new?projectId=${projectA}`);
      expect(form.status).toBe(200);
      expect(form.html).toContain('data-testid="invoice-project-unavailable"');
      expect(form.html).not.toContain('Apollo Launch');
    });
  });

  // -------------------------------------------------------------------------
  // 9. Lifecycle and reassignment
  // -------------------------------------------------------------------------

  describe('invoice lifecycle and reassignment restrictions', () => {
    it('links, reassigns and unlinks a draft, auditing every change', async () => {
      const invoice = await createInvoice({ title: 'Lifecycle draft', currency: 'EUR' });

      const link = await putInvoice(admin, invoice.id, { projectId: projectA });
      expect(link.status, JSON.stringify(link.body)).toBe(200);
      expect((link.body as InvoiceBody).project?.id).toBe(projectA);

      const move = await putInvoice(admin, invoice.id, { projectId: projectA2 });
      expect(move.status).toBe(200);
      expect(await storedProjectId(invoice.id)).toBe(projectA2);

      const unlink = await putInvoice(admin, invoice.id, { projectId: null });
      expect(unlink.status).toBe(200);
      expect((unlink.body as InvoiceBody).projectId).toBeNull();

      const audits = await projectChangeAudits(invoice.id);
      expect(audits.map((entry) => [entry.before.projectId, entry.after.projectId])).toEqual([
        [null, projectA],
        [projectA, projectA2],
        [projectA2, null],
      ]);
      expect(audits.every((entry) => entry.actorId === admin.userId)).toBe(true);
      expect(audits.every((entry) => entry.organizationId === admin.organizationId)).toBe(true);

      // Re-linking never touched the financial side of the invoice.
      const after = await getInvoice(admin, invoice.id);
      expect(after).toMatchObject({
        number: invoice.number,
        currency: 'EUR',
        subtotal: invoice.subtotal,
        tax: invoice.tax,
        total: invoice.total,
        status: 'draft',
      });
    });

    it('does not audit (or validate) a request that keeps the current project', async () => {
      const invoice = await createInvoice({ projectId: projectA });

      const same = await putInvoice(admin, invoice.id, { title: 'Renamed', projectId: projectA });
      expect(same.status).toBe(200);
      const omitted = await putInvoice(admin, invoice.id, { title: 'Renamed again' });
      expect(omitted.status).toBe(200);

      expect(await storedProjectId(invoice.id)).toBe(projectA);
      expect(await projectChangeAudits(invoice.id)).toHaveLength(0);
    });

    it('allows reassigning a sent invoice only while it has no payments', async () => {
      const invoice = await createInvoice({ projectId: projectA, status: 'sent' });

      const move = await putInvoice(admin, invoice.id, { projectId: projectA2 });
      expect(move.status, JSON.stringify(move.body)).toBe(200);

      const payment = await pay(invoice.id, { amount: '50.00' });
      expect(payment.status).toBe(201);

      const blocked = await putInvoice(admin, invoice.id, { projectId: projectA });
      expect(blocked.status).toBe(400);
      expect((blocked.body as { error: string }).error).toBe(
        'Cannot change the project of an invoice that has recorded payments'
      );
      const unlink = await putInvoice(admin, invoice.id, { projectId: null });
      expect(unlink.status).toBe(400);

      expect(await storedProjectId(invoice.id)).toBe(projectA2);
      expect(await projectChangeAudits(invoice.id)).toHaveLength(1);

      // The rest of the invoice stays editable under the existing rules.
      const rename = await putInvoice(admin, invoice.id, { notes: 'Partially paid' });
      expect(rename.status).toBe(200);
      expect(await storedProjectId(invoice.id)).toBe(projectA2);
    });

    it('never reassigns a paid, voided or deleted invoice', async () => {
      const paid = await createInvoice({ projectId: projectA, status: 'sent' });
      const settle = await pay(paid.id, { amount: paid.total });
      expect((settle.body as { invoiceStatus: string }).invoiceStatus).toBe('paid');

      const voided = await createInvoice({ projectId: projectA });
      expect((await putInvoice(admin, voided.id, { status: 'voided' })).status).toBe(200);

      const deleted = await createInvoice({ projectId: projectA });
      expect(
        (await api(admin, `/api/v1/crm/invoices/${deleted.id}`, { method: 'DELETE' })).status
      ).toBe(200);

      for (const invoice of [paid, voided, deleted]) {
        for (const target of [projectA2, null]) {
          const res = await putInvoice(admin, invoice.id, { projectId: target });
          expect(res.status, `${invoice.title} -> ${target}`).toBe(400);
        }
        expect(await storedProjectId(invoice.id)).toBe(projectA);
        expect(await projectChangeAudits(invoice.id)).toHaveLength(0);
      }
    });

    it('serialises a reassignment against a concurrent payment', async () => {
      // Whatever the interleaving, the outcome is one of the two legal ones:
      // moved-then-paid, or paid-and-not-moved. Never a half-applied state.
      for (let round = 0; round < 4; round += 1) {
        const invoice = await createInvoice({ projectId: projectA, status: 'sent' });
        const [move, payment] = await Promise.all([
          putInvoice(admin, invoice.id, { projectId: projectA2 }),
          pay(invoice.id, { amount: '25.00' }),
        ]);

        expect(payment.status).toBe(201);
        expect([200, 400]).toContain(move.status);

        const stored = await storedProjectId(invoice.id);
        const audits = await projectChangeAudits(invoice.id);
        expect(stored).toBe(move.status === 200 ? projectA2 : projectA);
        expect(audits).toHaveLength(move.status === 200 ? 1 : 0);
        expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(1);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 10. Payments, currencies, numbering
  // -------------------------------------------------------------------------

  describe('payments, currencies and numbering are unchanged', () => {
    it('computes identical totals and keeps the currency, linked or not', async () => {
      const lineItems = [
        { description: 'Design', quantity: '3', unitPrice: '199.99', taxRate: '17' },
        { description: 'Hosting', quantity: '1', unitPrice: '30.00', taxRate: '0' },
      ];
      const plain = await createInvoice({ currency: 'PKR', lineItems });
      const linked = await createInvoice({ currency: 'PKR', lineItems, projectId: projectA });

      expect(linked).toMatchObject({
        currency: 'PKR',
        subtotal: plain.subtotal,
        tax: plain.tax,
        total: plain.total,
      });
      expect(linked).toMatchObject({ subtotal: '629.97', tax: '101.99', total: '731.96' });
    });

    it('does not rewrite the currency when only the project is changed', async () => {
      const invoice = await createInvoice({ currency: 'EUR', title: 'EUR invoice' });

      const res = await putInvoice(admin, invoice.id, { projectId: projectA });
      expect(res.status).toBe(200);

      const row = (await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })) as {
        currency: string;
        number: string;
        total: { toString(): string };
      };
      expect(row.currency).toBe('EUR');
      expect(row.number).toBe(invoice.number);
      expect(Number(row.total.toString()).toFixed(2)).toBe(invoice.total);
    });

    it('keeps one gap-free number sequence across linked and unlinked invoices', async () => {
      const created = [
        await createInvoice({ title: 'Seq 1' }),
        await createInvoice({ title: 'Seq 2', projectId: projectA }),
        await createInvoice({ title: 'Seq 3', projectId: projectA2 }),
        await createInvoice({ title: 'Seq 4' }),
      ];
      const sequences = created.map((invoice) => sequenceOf(invoice.number));

      expect(sequences).toEqual([0, 1, 2, 3].map((offset) => sequences[0] + offset));
      // Same prefix for every invoice: numbering does not depend on the project.
      const prefixes = new Set(created.map((invoice) => invoice.number.replace(/\d+$/, '')));
      expect(prefixes.size).toBe(1);

      // Re-linking keeps the number.
      const moved = await putInvoice(admin, created[1].id, { projectId: projectA2 });
      expect((moved.body as InvoiceBody).number).toBe(created[1].number);
    });

    it('records payments on a linked invoice exactly as before', async () => {
      const invoice = await createInvoice({
        projectId: projectA,
        status: 'sent',
        lineItems: [{ description: 'Work', quantity: '1', unitPrice: '100.00', taxRate: '0' }],
      });
      const key = `phase5a-${Date.now()}`;

      const partial = await pay(invoice.id, { amount: '40.00', idempotencyKey: key });
      expect(partial.status).toBe(201);
      expect(partial.body).toMatchObject({
        invoiceStatus: 'sent',
        amountPaid: '40.00',
        balance: '60.00',
        duplicate: false,
      });

      // Idempotent replay: same payment, no second row.
      const replay = await pay(invoice.id, { amount: '40.00', idempotencyKey: key });
      expect(replay.status).toBe(201);
      expect(replay.body).toMatchObject({ duplicate: true, amountPaid: '40.00' });
      expect((replay.body as { payment: { id: string } }).payment.id).toBe(
        (partial.body as { payment: { id: string } }).payment.id
      );

      const over = await pay(invoice.id, { amount: '60.01' });
      expect(over.status).toBe(400);

      const rest = await pay(invoice.id, { amount: '60.00' });
      expect(rest.body).toMatchObject({ invoiceStatus: 'paid', balance: '0.00' });

      const final = await getInvoice(admin, invoice.id);
      expect(final.status).toBe('paid');
      expect(final.payments).toHaveLength(2);
      expect(final.total).toBe('100.00');
      expect(final.projectId).toBe(projectA);
    });
  });

  // -------------------------------------------------------------------------
  // 11. Migration compatibility
  // -------------------------------------------------------------------------

  describe('migration 0021', () => {
    it('is recorded and adds a nullable column with no default', async () => {
      const migrations = (await prisma.$queryRawUnsafe(
        `SELECT migration_name FROM "_prisma_migrations" WHERE migration_name = '0021_invoice_project_link' AND rolled_back_at IS NULL`
      )) as Array<{ migration_name: string }>;
      expect(migrations).toHaveLength(1);

      const columns = (await prisma.$queryRawUnsafe(
        `SELECT is_nullable, column_default, data_type FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'Invoice' AND column_name = 'projectId'`
      )) as Array<{ is_nullable: string; column_default: string | null; data_type: string }>;
      expect(columns).toEqual([{ is_nullable: 'YES', column_default: null, data_type: 'text' }]);
    });

    it('creates the composite foreign key with non-destructive actions, and both indexes', async () => {
      const constraints = (await prisma.$queryRawUnsafe(
        `SELECT pg_get_constraintdef(oid) AS def, confdeltype::text AS on_delete,
                confupdtype::text AS on_update, convalidated
           FROM pg_constraint WHERE conname = '${FK_NAME}'`
      )) as Array<{ def: string; on_delete: string; on_update: string; convalidated: boolean }>;
      expect(constraints).toHaveLength(1);
      expect(constraints[0].def).toContain(
        'FOREIGN KEY ("projectId", "organizationId") REFERENCES "Project"(id, "organizationId")'
      );
      // 'a' = NO ACTION. Never 'c' (CASCADE) or 'n' (SET NULL) for a financial record.
      expect(constraints[0]).toMatchObject({ on_delete: 'a', on_update: 'a', convalidated: true });

      const indexes = (await prisma.$queryRawUnsafe(
        `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema()
            AND indexname IN ('Project_id_organizationId_key', 'Invoice_organizationId_projectId_idx')`
      )) as Array<{ indexname: string; indexdef: string }>;
      const byName = new Map(indexes.map((row) => [row.indexname, row.indexdef]));
      expect(byName.get('Project_id_organizationId_key')).toMatch(
        /UNIQUE INDEX .* \(id, "organizationId"\)/
      );
      expect(byName.get('Invoice_organizationId_projectId_idx')).toMatch(
        /\("organizationId", "projectId"\)/
      );
    });

    it('leaves pre-existing style invoices valid, readable, editable and payable', async () => {
      // A row written the way every pre-0021 writer wrote it: no projectId at all.
      const number = `LEGACY-${Date.now()}`;
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Invoice" (id, "organizationId", number, title, status, subtotal, tax, total, currency, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'Legacy invoice', 'sent', 200, 20, 220, 'EUR', now(), now())`,
        `legacy_${Date.now()}`,
        admin.organizationId,
        number
      );
      const legacy = (await prisma.invoice.findFirstOrThrow({
        where: { organizationId: admin.organizationId, number },
      })) as { id: string; projectId: string | null };
      expect(legacy.projectId).toBeNull();

      const read = await getInvoice(admin, legacy.id);
      expect(read).toMatchObject({
        number,
        currency: 'EUR',
        total: '220.00',
        projectId: null,
        project: null,
      });

      const edit = await putInvoice(admin, legacy.id, { notes: 'Edited after migration' });
      expect(edit.status).toBe(200);
      const payment = await pay(legacy.id, { amount: '220.00' });
      expect(payment.body).toMatchObject({ invoiceStatus: 'paid', balance: '0.00' });

      const row = (await prisma.invoice.findUniqueOrThrow({ where: { id: legacy.id } })) as {
        number: string;
        currency: string;
        projectId: string | null;
      };
      expect(row).toMatchObject({ number, currency: 'EUR', projectId: null });
    });

    it('never links invoices on its own (no backfill)', async () => {
      // Same organization, a project exists, yet an invoice created without a
      // project stays unlinked - nothing is inferred from client or timing.
      const invoice = await createInvoice({ title: 'Stays unlinked' });
      expect(await storedProjectId(invoice.id)).toBeNull();

      const implicit = (await prisma.$queryRawUnsafe(
        `SELECT count(*)::int AS n FROM "Invoice" i
          WHERE i."projectId" IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM "Project" p
                             WHERE p.id = i."projectId" AND p."organizationId" = i."organizationId")`
      )) as Array<{ n: number }>;
      expect(implicit[0].n).toBe(0);
    });

    it('still lets a whole organization be deleted, taking its linked invoices with it', async () => {
      const disposable = await createOrganizationWithAdmin('project-invoices-disposable');
      const project = (await prisma.project.create({
        data: { organizationId: disposable.organizationId, name: 'Disposable' },
      })) as { id: string };
      const invoice = (await prisma.invoice.create({
        data: {
          organizationId: disposable.organizationId,
          number: `DISP-${Date.now()}`,
          title: 'Disposable invoice',
          projectId: project.id,
        },
      })) as { id: string };

      await prisma.organization.delete({ where: { id: disposable.organizationId } });

      expect(await prisma.invoice.count({ where: { id: invoice.id } })).toBe(0);
      expect(await prisma.project.count({ where: { id: project.id } })).toBe(0);
      await prisma.user.deleteMany({ where: { id: disposable.userId } }).catch(() => {});
    });

    it('is reversible: the rollback DDL succeeds (rolled back, database left unchanged)', async () => {
      await prisma
        .$transaction(async (tx: typeof prisma) => {
          await tx.$executeRawUnsafe(`ALTER TABLE "Invoice" DROP CONSTRAINT "${FK_NAME}"`);
          await tx.$executeRawUnsafe(`DROP INDEX "Invoice_organizationId_projectId_idx"`);
          await tx.$executeRawUnsafe(`ALTER TABLE "Invoice" DROP COLUMN "projectId"`);
          // Project_id_organizationId_key is also referenced by TimeEntry (migration 0022).
          // Drop TimeEntry's composite FK first inside this rolled-back test so the
          // full rollback of the shared unique index can still be verified.
          await tx.$executeRawUnsafe(
            `ALTER TABLE "TimeEntry" DROP CONSTRAINT IF EXISTS "TimeEntry_projectId_organizationId_fkey"`
          );
          await tx.$executeRawUnsafe(`DROP INDEX "Project_id_organizationId_key"`);
          const columns = (await tx.$queryRawUnsafe(
            `SELECT count(*)::int AS n FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name = 'Invoice' AND column_name = 'projectId'`
          )) as Array<{ n: number }>;
          expect(columns[0].n).toBe(0);
          throw new Error('ROLLBACK_ON_PURPOSE');
        })
        .catch((error: Error) => {
          if (error.message !== 'ROLLBACK_ON_PURPOSE') throw error;
        });

      const constraints = (await prisma.$queryRawUnsafe(
        `SELECT count(*)::int AS n FROM pg_constraint WHERE conname = '${FK_NAME}'`
      )) as Array<{ n: number }>;
      expect(constraints[0].n).toBe(1);
    });
  });
});
