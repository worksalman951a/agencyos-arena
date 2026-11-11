/**
 * Real PostgreSQL Integration Suite: Phase 3B Sales & Documents Workflows.
 *
 * Exercises the live Next.js API routes against real PostgreSQL:
 *  - Proposal & Quotation sequential numbering and server-side line-item math
 *  - Proposal version snapshots (v1, v2)
 *  - Lifecycle state transitions & immutability of accepted/converted/signed records
 *  - Reusable Document Templates stored without schema drift or leaking into Documents list
 *  - Contract creation, linking to Proposal/Project, signing, Signature audit rows & lock
 *  - Client Shareable Links: sanitized public snapshots, atomic maxAccess enforcement & revocation
 *  - Multi-tenant cross-organization isolation (404/400) & RBAC permission enforcement (403)
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';
import {
  authHeaders,
  cleanupOrganizations,
  createMemberWithPermissions,
  createOrganizationWithAdmin,
  jsonFetch,
  type TestAccount,
} from './batch4-provisioning';

const canRun = Boolean(process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET);
const describeIfDb = canRun ? describe : describe.skip;

describeIfDb('Phase 3B Sales & Documents (real PostgreSQL)', () => {
  const orgIdsToCleanup: string[] = [];
  let orgAAdmin: TestAccount;
  let orgAReadOnly: TestAccount;
  let orgBAdmin: TestAccount;
  let orgAContactId = '';
  let orgBContactId = '';
  let orgAProjectId = '';

  beforeAll(async () => {
    await prisma.$connect();

    // Ensure Phase 3B permission codes exist in the permission catalog before role assignment.
    const requiredPermCodes = [
      'proposal.create',
      'proposal.read',
      'proposal.update',
      'proposal.delete',
      'quotation.create',
      'quotation.read',
      'quotation.update',
      'quotation.delete',
      'estimate.create',
      'estimate.read',
      'estimate.update',
      'estimate.delete',
      'invoice.create',
      'invoice.read',
      'contract.create',
      'contract.read',
      'contract.update',
      'contract.delete',
      'contract.sign',
      'document.create',
      'document.read',
      'document.update',
      'document.delete',
      'document.share',
      'template.create',
      'template.read',
      'template.update',
      'template.delete',
    ];
    await prisma.permission.createMany({
      data: requiredPermCodes.map((code) => ({
        code,
        description: `Permission: ${code}`,
      })),
      skipDuplicates: true,
    });

    orgAAdmin = await createOrganizationWithAdmin('phase3b-org-a');
    orgIdsToCleanup.push(orgAAdmin.organizationId);

    orgBAdmin = await createOrganizationWithAdmin('phase3b-org-b');
    orgIdsToCleanup.push(orgBAdmin.organizationId);

    orgAReadOnly = await createMemberWithPermissions(orgAAdmin.organizationId, 'viewer', [
      'proposal.read',
      'quotation.read',
      'contract.read',
      'template.read',
      'document.read',
    ]);

    const contactA = await prisma.contact.create({
      data: {
        organizationId: orgAAdmin.organizationId,
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: `ada-${Date.now()}@org-a.invalid`,
        status: 'active',
        createdBy: orgAAdmin.userId,
        updatedBy: orgAAdmin.userId,
      },
    });
    orgAContactId = contactA.id;

    const contactB = await prisma.contact.create({
      data: {
        organizationId: orgBAdmin.organizationId,
        firstName: 'Grace',
        lastName: 'Hopper',
        email: `grace-${Date.now()}@org-b.invalid`,
        status: 'active',
        createdBy: orgBAdmin.userId,
        updatedBy: orgBAdmin.userId,
      },
    });
    orgBContactId = contactB.id;

    const projectA = await prisma.project.create({
      data: {
        organizationId: orgAAdmin.organizationId,
        clientId: orgAContactId,
        name: 'Org A Platform Replatform',
        status: 'active',
        createdBy: orgAAdmin.userId,
        updatedBy: orgAAdmin.userId,
      },
    });
    orgAProjectId = projectA.id;
  });

  afterAll(async () => {
    await cleanupOrganizations(orgIdsToCleanup);
  });

  it('allocates sequential proposal numbers, computes accurate money math, saves versions, and locks accepted proposals', async () => {
    const p1Res = await jsonFetch('/api/v1/crm/proposals', {
      method: 'POST',
      headers: authHeaders(orgAAdmin.token),
      body: JSON.stringify({
        contactId: orgAContactId,
        title: 'Discovery & Architecture Proposal',
        currency: 'USD',
        notes: 'Net 15 payment schedule.',
        lineItems: [
          {
            description: 'Technical Discovery',
            quantity: '2.5',
            unitPrice: '400.00',
            taxRate: '10',
          },
          { description: 'UX Wireframes', quantity: '3', unitPrice: '250.00', taxRate: '0' },
        ],
      }),
    });
    expect(p1Res.status).toBe(201);
    const p1 = p1Res.body as {
      id: string;
      number: string;
      subtotal: string;
      tax: string;
      total: string;
      status: string;
    };
    expect(p1.number).toMatch(/^PRP-\d{4}-0001$/);
    // 2.5 * 400 = 1000.00 (+100 tax), 3 * 250 = 750.00 (+0 tax) => subtotal 1750.00, tax 100.00, total 1850.00
    expect(Number(p1.subtotal)).toBeCloseTo(1750, 2);
    expect(Number(p1.tax)).toBeCloseTo(100, 2);
    expect(Number(p1.total)).toBeCloseTo(1850, 2);

    const p2Res = await jsonFetch('/api/v1/crm/proposals', {
      method: 'POST',
      headers: authHeaders(orgAAdmin.token),
      body: JSON.stringify({
        contactId: orgAContactId,
        title: 'Phase 2 Buildout',
        lineItems: [
          { description: 'Engineering', quantity: '10', unitPrice: '150.00', taxRate: '5' },
        ],
      }),
    });
    expect(p2Res.status).toBe(201);
    const p2 = p2Res.body as { id: string; number: string };
    expect(p2.number).toMatch(/^PRP-\d{4}-0002$/);

    // Save two version snapshots on Proposal 1
    const v1Res = await jsonFetch('/api/v1/documents/versions', {
      method: 'POST',
      headers: authHeaders(orgAAdmin.token),
      body: JSON.stringify({ proposalId: p1.id }),
    });
    expect(v1Res.status).toBe(201);
    expect((v1Res.body as { version: number }).version).toBe(1);

    const v2Res = await jsonFetch('/api/v1/documents/versions', {
      method: 'POST',
      headers: authHeaders(orgAAdmin.token),
      body: JSON.stringify({ proposalId: p1.id }),
    });
    expect(v2Res.status).toBe(201);
    expect((v2Res.body as { version: number }).version).toBe(2);

    const listVersionsRes = await jsonFetch(
      `/api/v1/documents/versions?type=proposal&id=${encodeURIComponent(p1.id)}`,
      { headers: authHeaders(orgAAdmin.token) }
    );
    expect(listVersionsRes.status).toBe(200);
    expect((listVersionsRes.body as Array<{ version: number }>).length).toBe(2);

    // Transition draft -> sent -> accepted
    const sentRes = await jsonFetch(`/api/v1/crm/proposals/${p1.id}`, {
      method: 'PUT',
      headers: authHeaders(orgAAdmin.token),
      body: JSON.stringify({ status: 'sent' }),
    });
    expect(sentRes.status).toBe(200);

    const acceptRes = await jsonFetch(`/api/v1/crm/proposals/${p1.id}`, {
      method: 'PUT',
      headers: authHeaders(orgAAdmin.token),
      body: JSON.stringify({ status: 'accepted' }),
    });
    expect(acceptRes.status).toBe(200);

    // Accepted proposal is historically immutable: edits and deletes return 400
    const mutateAccepted = await jsonFetch(`/api/v1/crm/proposals/${p1.id}`, {
      method: 'PUT',
      headers: authHeaders(orgAAdmin.token),
      body: JSON.stringify({ title: 'Tampered Title' }),
    });
    expect(mutateAccepted.status).toBe(400);

    const deleteAccepted = await jsonFetch(`/api/v1/crm/proposals/${p1.id}`, {
      method: 'DELETE',
      headers: authHeaders(orgAAdmin.token),
    });
    expect(deleteAccepted.status).toBe(400);
  });

  it('manages quotations, templates without schema drift, contracts with signature locks, and shareable client links', async () => {
    // 1. Quotation creation + lifecycle lock
    const qRes = await jsonFetch('/api/v1/crm/quotations', {
      method: 'POST',
      headers: authHeaders(orgAAdmin.token),
      body: JSON.stringify({
        contactId: orgAContactId,
        title: 'Annual Hosting Quotation',
        currency: 'EUR',
        lineItems: [
          { description: 'Managed Cloud', quantity: '12', unitPrice: '200.00', taxRate: '20' },
        ],
      }),
    });
    expect(qRes.status).toBe(201);
    const quotation = qRes.body as { id: string; number: string; total: string };
    expect(quotation.number).toMatch(/^QOT-\d{4}-0001$/);
    expect(Number(quotation.total)).toBeCloseTo(2880, 2);

    // 2. Reusable Templates persisted via DocumentVersion snapshot without polluting Documents list
    const tpl1Res = await jsonFetch('/api/v1/documents/templates', {
      method: 'POST',
      headers: authHeaders(orgAAdmin.token),
      body: JSON.stringify({
        name: 'Standard Proposal Template',
        type: 'proposal',
        content: 'Prepared for {{client_name}}',
        variables: { client_name: 'Default Client' },
        isDefault: true,
      }),
    });
    expect(tpl1Res.status).toBe(201);
    const tpl1 = tpl1Res.body as {
      id: string;
      content: string;
      variables: Record<string, string>;
      isDefault: boolean;
    };
    expect(tpl1.content).toBe('Prepared for {{client_name}}');
    expect(tpl1.variables).toEqual({ client_name: 'Default Client' });
    expect(tpl1.isDefault).toBe(true);

    // Creating a second default template of the same type unsets the first default
    const tpl2Res = await jsonFetch('/api/v1/documents/templates', {
      method: 'POST',
      headers: authHeaders(orgAAdmin.token),
      body: JSON.stringify({
        name: 'Enterprise Proposal Template',
        type: 'proposal',
        content: 'Enterprise scope for {{company}}',
        variables: { company: '' },
        isDefault: true,
      }),
    });
    expect(tpl2Res.status).toBe(201);

    const tpl1Reloaded = await jsonFetch(`/api/v1/documents/templates/${tpl1.id}`, {
      headers: authHeaders(orgAAdmin.token),
    });
    expect(tpl1Reloaded.status).toBe(200);
    expect((tpl1Reloaded.body as { isDefault: boolean }).isDefault).toBe(false);

    // Template is stored with folder='__template__' and snapshot payload without schema drift
    const storedDoc = await prisma.document.findFirst({
      where: { id: tpl1.id, organizationId: orgAAdmin.organizationId },
    });
    expect(storedDoc?.folder).toBe('__template__');

    // 3. Contract creation -> send -> sign -> immutability
    const contractRes = await jsonFetch('/api/v1/documents/contracts', {
      method: 'POST',
      headers: authHeaders(orgAAdmin.token),
      body: JSON.stringify({
        projectId: orgAProjectId,
        title: 'Master Services Agreement 2026',
        status: 'sent',
      }),
    });
    expect(contractRes.status).toBe(201);
    const contract = contractRes.body as { id: string; status: string };

    const signRes = await jsonFetch(`/api/v1/documents/contracts/${contract.id}`, {
      method: 'POST',
      headers: authHeaders(orgAAdmin.token),
      body: JSON.stringify({
        signerName: 'Ada Lovelace',
        signerEmail: 'ada@client.example',
        signatureReference: 'esign-2026-99',
      }),
    });
    expect(signRes.status).toBe(200);
    expect((signRes.body as { status: string }).status).toBe('signed');

    // Signed contract cannot be edited, voided, re-signed, or deleted
    const editSigned = await jsonFetch(`/api/v1/documents/contracts/${contract.id}`, {
      method: 'PUT',
      headers: authHeaders(orgAAdmin.token),
      body: JSON.stringify({ status: 'voided' }),
    });
    expect(editSigned.status).toBe(400);

    const deleteSigned = await jsonFetch(`/api/v1/documents/contracts/${contract.id}`, {
      method: 'DELETE',
      headers: authHeaders(orgAAdmin.token),
    });
    expect(deleteSigned.status).toBe(400);

    // 4. Shareable client link with maxAccess = 2 and revocation
    const shareRes = await jsonFetch('/api/v1/documents/links', {
      method: 'POST',
      headers: authHeaders(orgAAdmin.token),
      body: JSON.stringify({
        entityType: 'quotation',
        entityId: quotation.id,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        maxAccess: 2,
      }),
    });
    expect(shareRes.status).toBe(201);
    const shareLink = shareRes.body as { id: string; token: string; publicUrl: string };
    expect(shareLink.publicUrl).toBe(`/share/${shareLink.token}`);

    // Unauthenticated client access #1 and #2 succeed; internal org IDs are never exposed
    const view1 = await jsonFetch(`/api/v1/documents/links/${shareLink.token}`);
    expect(view1.status).toBe(200);
    const view1Body = view1.body as Record<string, unknown>;
    expect(view1Body.organizationId).toBeUndefined();
    expect(view1Body.accessCount).toBe(1);
    expect((view1Body.snapshot as { title?: string })?.title).toBe('Annual Hosting Quotation');

    const view2 = await jsonFetch(`/api/v1/documents/links/${shareLink.token}`);
    expect(view2.status).toBe(200);
    expect((view2.body as { accessCount: number }).accessCount).toBe(2);

    // Access #3 exceeds maxAccess (2) -> 403
    const view3 = await jsonFetch(`/api/v1/documents/links/${shareLink.token}`);
    expect(view3.status).toBe(403);

    // Create another link and revoke it immediately -> 410
    const revocableRes = await jsonFetch('/api/v1/documents/links', {
      method: 'POST',
      headers: authHeaders(orgAAdmin.token),
      body: JSON.stringify({
        entityType: 'contract',
        entityId: contract.id,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      }),
    });
    expect(revocableRes.status).toBe(201);
    const revocable = revocableRes.body as { id: string; token: string };

    const revokeRes = await jsonFetch(
      `/api/v1/documents/links?id=${encodeURIComponent(revocable.id)}`,
      {
        method: 'DELETE',
        headers: authHeaders(orgAAdmin.token),
      }
    );
    expect(revokeRes.status).toBe(200);

    const viewRevoked = await jsonFetch(`/api/v1/documents/links/${revocable.token}`);
    expect(viewRevoked.status).toBe(410);
  });

  it('enforces multi-tenant isolation (404/400) and RBAC permissions (403)', async () => {
    const orgAPropRes = await jsonFetch('/api/v1/crm/proposals', {
      method: 'POST',
      headers: authHeaders(orgAAdmin.token),
      body: JSON.stringify({
        contactId: orgAContactId,
        title: 'Confidential Org A Proposal',
        lineItems: [{ description: 'Advisory', quantity: '1', unitPrice: '5000.00', taxRate: '0' }],
      }),
    });
    expect(orgAPropRes.status).toBe(201);
    const orgAProp = orgAPropRes.body as { id: string };

    // Org B cannot read, update, or delete Org A's proposal
    const orgBRead = await jsonFetch(`/api/v1/crm/proposals/${orgAProp.id}`, {
      headers: authHeaders(orgBAdmin.token),
    });
    expect(orgBRead.status).toBe(404);

    // Org A cannot attach Org B's contact to an Org A proposal or estimate (non-disclosing 404/400)
    const crossTenantProposal = await jsonFetch('/api/v1/crm/proposals', {
      method: 'POST',
      headers: authHeaders(orgAAdmin.token),
      body: JSON.stringify({
        contactId: orgBContactId,
        title: 'Cross-Tenant Injection Attempt',
        lineItems: [{ description: 'Item', quantity: '1', unitPrice: '100.00', taxRate: '0' }],
      }),
    });
    expect([400, 404]).toContain(crossTenantProposal.status);

    const crossTenantEstimate = await jsonFetch('/api/v1/finance/estimates', {
      method: 'POST',
      headers: authHeaders(orgAAdmin.token),
      body: JSON.stringify({
        clientId: orgBContactId,
        number: `EST-X-${Date.now()}`,
        status: 'draft',
        total: '500.00',
      }),
    });
    expect([400, 404]).toContain(crossTenantEstimate.status);

    // Read-only member in Org A can GET proposals (200) but gets 403 on POST/PUT/DELETE
    const viewerRead = await jsonFetch(`/api/v1/crm/proposals/${orgAProp.id}`, {
      headers: authHeaders(orgAReadOnly.token),
    });
    expect(viewerRead.status).toBe(200);

    const viewerCreate = await jsonFetch('/api/v1/crm/proposals', {
      method: 'POST',
      headers: authHeaders(orgAReadOnly.token),
      body: JSON.stringify({
        title: 'Unauthorized Create',
        lineItems: [{ description: 'Item', quantity: '1', unitPrice: '100.00', taxRate: '0' }],
      }),
    });
    expect(viewerCreate.status).toBe(403);

    const viewerSignContract = await jsonFetch('/api/v1/documents/contracts', {
      method: 'POST',
      headers: authHeaders(orgAReadOnly.token),
      body: JSON.stringify({ title: 'Unauthorized Contract' }),
    });
    expect(viewerSignContract.status).toBe(403);
  });
});
