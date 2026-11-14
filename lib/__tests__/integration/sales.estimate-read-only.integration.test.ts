/**
 * Integration: estimates are historical and read-only (real PostgreSQL + live
 * HTTP routes).
 *
 * The unit suites pin the intention; this suite proves it against a real
 * database and the real route handlers:
 *
 *  1. every retired mutation is refused with `403` and the coded read-only body
 *     — create, edit, send/status change, duplicate, delete and conversion to
 *     invoice — and the stored row is byte-for-byte unchanged afterwards;
 *  2. nothing was written as a side effect: no invoice, no extra estimate row,
 *     no audit entry for a refused action;
 *  3. historical access is intact: the record is still listed, still readable
 *     and still downloadable as an authorized PDF, with `id + organizationId`
 *     scoping (another tenant gets the same non-disclosing 404);
 *  4. both approved quotation → invoice flows still work in the same tenant:
 *     Quotation → Invoice, and Quotation → Agreement → Invoice.
 *
 * Requires DATABASE_URL and a running server; skips otherwise.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';
import { ESTIMATE_READ_ONLY_CODE } from '@/lib/sales/estimate-retirement';
import {
  authHeaders,
  cleanupOrganizations,
  createOrganizationWithAdmin,
  jsonFetch,
  type TestAccount,
} from './batch4-provisioning';

const canRun = Boolean(process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET);
const describeIfDb = canRun ? describe : describe.skip;

describeIfDb('Estimate retirement: historical records are read-only (real PostgreSQL)', () => {
  const orgIdsToCleanup: string[] = [];
  let orgA: TestAccount;
  let orgB: TestAccount;
  let contactAId = '';
  let estimateId = '';
  let estimateNumber = '';

  const estimateState = async () => {
    const row = await prisma.estimate.findUniqueOrThrow({ where: { id: estimateId } });
    return {
      id: row.id,
      number: row.number,
      status: row.status,
      total: row.total.toString(),
      currency: row.currency,
      notes: row.notes,
      clientId: row.clientId,
      organizationId: row.organizationId,
      updatedAt: row.updatedAt.toISOString(),
    };
  };

  beforeAll(async () => {
    await prisma.$connect();

    await prisma.permission.createMany({
      data: [
        'estimate.read',
        'estimate.create',
        'estimate.update',
        'estimate.delete',
        'quotation.create',
        'quotation.read',
        'quotation.update',
        'invoice.create',
        'invoice.read',
        'contract.create',
        'contract.read',
      ].map((code) => ({ code, description: `Permission: ${code}` })),
      skipDuplicates: true,
    });

    orgA = await createOrganizationWithAdmin('estimate-readonly-a');
    orgIdsToCleanup.push(orgA.organizationId);

    orgB = await createOrganizationWithAdmin('estimate-readonly-b');
    orgIdsToCleanup.push(orgB.organizationId);

    const contact = await prisma.contact.create({
      data: {
        organizationId: orgA.organizationId,
        firstName: 'Historical',
        lastName: 'Client',
        email: `estimate-history-${Date.now()}@client.invalid`,
        status: 'active',
        createdBy: orgA.userId,
        updatedBy: orgA.userId,
      },
    });
    contactAId = contact.id;

    // Seeded directly: there is no API able to create an estimate any more,
    // which is exactly the property under test.
    estimateNumber = `EST-2025-${Math.floor(Math.random() * 9000) + 1000}`;
    const estimate = await prisma.estimate.create({
      data: {
        organizationId: orgA.organizationId,
        number: estimateNumber,
        clientId: contactAId,
        status: 'accepted',
        total: '4200.00',
        currency: 'EUR',
        validUntil: new Date('2025-12-31T00:00:00.000Z'),
        notes: 'Issued before the retirement; must never change.',
      },
    });
    estimateId = estimate.id;
  });

  afterAll(async () => {
    await cleanupOrganizations(orgIdsToCleanup).catch(() => {});
    await prisma.$disconnect();
  });

  describe('every mutation is refused and changes nothing', () => {
    const mutations: Array<{
      label: string;
      action: string;
      run: () => Promise<{ status: number; body: unknown }>;
    }> = [
      {
        label: 'create',
        action: 'create',
        run: () =>
          jsonFetch('/api/v1/finance/estimates', {
            method: 'POST',
            headers: authHeaders(orgA.token),
            body: JSON.stringify({
              clientId: contactAId,
              number: `EST-NEW-${Date.now()}`,
              status: 'draft',
              total: '999.00',
              currency: 'USD',
            }),
          }),
      },
      {
        label: 'edit',
        action: 'edit',
        run: () =>
          jsonFetch(`/api/v1/finance/estimates/${estimateId}`, {
            method: 'PUT',
            headers: authHeaders(orgA.token),
            body: JSON.stringify({ notes: 'Tampered note', total: '1.00' }),
          }),
      },
      {
        label: 'send / status change',
        action: 'edit',
        run: () =>
          jsonFetch(`/api/v1/finance/estimates/${estimateId}`, {
            method: 'PUT',
            headers: authHeaders(orgA.token),
            body: JSON.stringify({ status: 'sent' }),
          }),
      },
      {
        label: 'patch (status change)',
        action: 'edit',
        run: () =>
          jsonFetch(`/api/v1/finance/estimates/${estimateId}`, {
            method: 'PATCH',
            headers: authHeaders(orgA.token),
            body: JSON.stringify({ status: 'rejected' }),
          }),
      },
      {
        label: 'duplicate',
        action: 'create',
        run: () =>
          jsonFetch('/api/v1/finance/estimates', {
            method: 'POST',
            headers: authHeaders(orgA.token),
            body: JSON.stringify({
              clientId: contactAId,
              number: `${estimateNumber}-COPY`,
              status: 'accepted',
              total: '4200.00',
              currency: 'EUR',
              notes: 'Duplicated historical estimate',
            }),
          }),
      },
      {
        label: 'delete',
        action: 'delete',
        run: () =>
          jsonFetch(`/api/v1/finance/estimates/${estimateId}`, {
            method: 'DELETE',
            headers: authHeaders(orgA.token),
          }),
      },
      {
        label: 'convert to invoice',
        action: 'convert',
        run: () =>
          jsonFetch(`/api/v1/finance/estimates/${estimateId}/convert`, {
            method: 'POST',
            headers: authHeaders(orgA.token),
            body: JSON.stringify({ invoiceTitle: 'Invoice from historical estimate' }),
          }),
      },
    ];

    it.each(mutations)('refuses $label', async (mutation) => {
      const before = await estimateState();
      const invoicesBefore = await prisma.invoice.count({
        where: { organizationId: orgA.organizationId },
      });
      const estimatesBefore = await prisma.estimate.count({
        where: { organizationId: orgA.organizationId },
      });
      const auditBefore = await prisma.auditLog.count({
        where: { organizationId: orgA.organizationId },
      });

      const res = await mutation.run();

      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body).toMatchObject({
        code: ESTIMATE_READ_ONLY_CODE,
        action: mutation.action,
      });

      // The record is untouched…
      expect(await estimateState()).toEqual(before);
      // …and nothing was created, deleted or audited as a side effect.
      expect(await prisma.invoice.count({ where: { organizationId: orgA.organizationId } })).toBe(
        invoicesBefore
      );
      expect(await prisma.estimate.count({ where: { organizationId: orgA.organizationId } })).toBe(
        estimatesBefore
      );
      expect(await prisma.auditLog.count({ where: { organizationId: orgA.organizationId } })).toBe(
        auditBefore
      );
    });

    it('survives the whole refusal sweep with its original values', async () => {
      expect(await estimateState()).toMatchObject({
        id: estimateId,
        number: estimateNumber,
        status: 'accepted',
        total: '4200',
        currency: 'EUR',
        notes: 'Issued before the retirement; must never change.',
        clientId: contactAId,
        organizationId: orgA.organizationId,
      });
    });

    it('refuses mutations regardless of how privileged the caller is', async () => {
      // The refusal is unconditional, so an administrator (orgA) — who holds
      // estimate.update/delete from the bootstrap catalog — is refused just the
      // same. This assertion exists so a future "allow admins" change fails.
      const res = await jsonFetch(`/api/v1/finance/estimates/${estimateId}`, {
        method: 'DELETE',
        headers: authHeaders(orgA.token),
      });
      expect(res.status).toBe(403);
      expect(await prisma.estimate.findUnique({ where: { id: estimateId } })).not.toBeNull();
    });
  });

  describe('historical access is preserved', () => {
    it('lists the historical estimate', async () => {
      const res = await jsonFetch('/api/v1/finance/estimates', {
        headers: authHeaders(orgA.token),
      });

      expect(res.status).toBe(200);
      const list = res.body as Array<{ id: string; number: string; status: string }>;
      expect(list.some((row) => row.id === estimateId && row.number === estimateNumber)).toBe(true);
    });

    it('reads the historical estimate', async () => {
      const res = await jsonFetch(`/api/v1/finance/estimates/${estimateId}`, {
        headers: authHeaders(orgA.token),
      });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: estimateId,
        number: estimateNumber,
        status: 'accepted',
        total: '4200.00',
        currency: 'EUR',
        client: { id: contactAId, lastName: 'Client' },
      });
    });

    it('still renders and downloads the PDF', async () => {
      const res = await fetch(
        `${process.env.TEST_SERVER_URL ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3001'}/api/v1/finance/estimates/${estimateId}/pdf`,
        { headers: authHeaders(orgA.token) }
      );
      const bytes = Buffer.from(await res.arrayBuffer());

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/pdf');
      expect(res.headers.get('content-disposition')).toContain(`Estimate_${estimateNumber}.pdf`);
      // A real PDF document, not an error page.
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('keeps tenant scoping: another organization sees a non-disclosing 404', async () => {
      const read = await jsonFetch(`/api/v1/finance/estimates/${estimateId}`, {
        headers: authHeaders(orgB.token),
      });
      expect(read.status).toBe(404);
      expect(read.body).toMatchObject({ error: 'Not found' });

      const list = await jsonFetch('/api/v1/finance/estimates', {
        headers: authHeaders(orgB.token),
      });
      const rows = list.body as Array<{ id: string }>;
      expect(rows.some((row) => row.id === estimateId)).toBe(false);

      const pdf = await fetch(
        `${process.env.TEST_SERVER_URL ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3001'}/api/v1/finance/estimates/${estimateId}/pdf`,
        { headers: authHeaders(orgB.token) }
      );
      expect(pdf.status).toBe(404);
    });

    it('requires a session for reads and refusals alike', async () => {
      const read = await jsonFetch(`/api/v1/finance/estimates/${estimateId}`, {
        headers: { Accept: 'application/json' },
      });
      expect(read.status).toBe(401);

      // The refusal is about the record being read-only, not about the caller,
      // so an anonymous mutation gets the same coded refusal.
      const mutation = await jsonFetch(`/api/v1/finance/estimates/${estimateId}`, {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
      });
      expect(mutation.status).toBe(403);
      expect(await prisma.estimate.findUnique({ where: { id: estimateId } })).not.toBeNull();
    });
  });

  describe('the approved quotation flows still work', () => {
    const createAcceptedQuotation = async (title: string) => {
      const created = await jsonFetch('/api/v1/crm/quotations', {
        method: 'POST',
        headers: authHeaders(orgA.token),
        body: JSON.stringify({
          contactId: contactAId,
          title,
          currency: 'EUR',
          notes: 'Approved workflow regression',
          lineItems: [
            {
              description: 'Retirement follow-up retainer',
              quantity: '1',
              unitPrice: '1200',
              taxRate: '10',
              sortOrder: 0,
            },
          ],
        }),
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const quotation = created.body as { id: string; total: string };

      for (const status of ['sent', 'accepted']) {
        const transition = await jsonFetch(`/api/v1/crm/quotations/${quotation.id}`, {
          method: 'PUT',
          headers: authHeaders(orgA.token),
          body: JSON.stringify({ status }),
        });
        expect(transition.status, JSON.stringify(transition.body)).toBe(200);
      }
      return quotation;
    };

    it('supports Quotation → Invoice (default path)', async () => {
      const quotation = await createAcceptedQuotation('Default path quotation');

      const res = await jsonFetch(`/api/v1/crm/quotations/${quotation.id}/invoice`, {
        method: 'POST',
        headers: authHeaders(orgA.token),
        body: JSON.stringify({}),
      });

      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body).toMatchObject({
        quotationId: quotation.id,
        status: 'draft',
        total: '1320.00',
        currency: 'EUR',
      });
    });

    it('supports Quotation → Agreement → Invoice (optional path)', async () => {
      const quotation = await createAcceptedQuotation('Agreement path quotation');

      const agreement = await jsonFetch(`/api/v1/crm/quotations/${quotation.id}/agreement`, {
        method: 'POST',
        headers: authHeaders(orgA.token),
        body: JSON.stringify({}),
      });
      expect(agreement.status, JSON.stringify(agreement.body)).toBe(201);
      expect(agreement.body).toMatchObject({ quotationId: quotation.id, status: 'draft' });

      const replay = await jsonFetch(`/api/v1/crm/quotations/${quotation.id}/agreement`, {
        method: 'POST',
        headers: authHeaders(orgA.token),
        body: JSON.stringify({}),
      });
      expect(replay.status, JSON.stringify(replay.body)).toBe(201);
      // Idempotent replay: the same agreement, never a second one.
      expect((replay.body as { id: string }).id).toBe((agreement.body as { id: string }).id);
      expect(
        await prisma.contract.count({
          where: { organizationId: orgA.organizationId, quotationId: quotation.id },
        })
      ).toBe(1);

      const invoice = await jsonFetch(`/api/v1/crm/quotations/${quotation.id}/invoice`, {
        method: 'POST',
        headers: authHeaders(orgA.token),
        body: JSON.stringify({}),
      });
      expect(invoice.status, JSON.stringify(invoice.body)).toBe(201);
      expect(invoice.body).toMatchObject({ quotationId: quotation.id, status: 'draft' });
    });

    it('never produced an estimate from either flow', async () => {
      // Exactly one estimate exists in this tenant: the seeded historical row.
      const count = await prisma.estimate.count({
        where: { organizationId: orgA.organizationId },
      });
      expect(count).toBe(1);
    });
  });
});
