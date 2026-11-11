import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  proposalCreateSchema,
  proposalLineItemSchema,
  proposalUpdateSchema,
} from '@/lib/schemas/crm/proposal.schema';
import {
  quotationCreateSchema,
  quotationLineItemSchema,
  quotationUpdateSchema,
} from '@/lib/schemas/crm/quotation.schema';
import { estimateCreateSchema, estimateUpdateSchema } from '@/lib/schemas/crm/estimate.schema';
import {
  contractCreateSchema,
  contractSignSchema,
  contractUpdateSchema,
} from '@/lib/schemas/documents/contract.schema';
import {
  templateCreateSchema,
  templateUpdateSchema,
} from '@/lib/schemas/documents/template.schema';
import { salesDocumentShareLinkCreateSchema } from '@/lib/schemas/documents/link.schema';

const SAMPLE_CUID = 'cm9x123450000abcdefgh1234';

describe('Phase 3B — Sales & Document Schemas and Permissions', () => {
  it('rejects spoofed organizationId and computed totals on proposalCreateSchema', () => {
    const spoofed = proposalCreateSchema.safeParse({
      title: 'Website Redesign',
      organizationId: 'org-evil',
    });
    expect(spoofed.success).toBe(false);

    const valid = proposalCreateSchema.safeParse({
      title: 'Website Redesign',
      currency: 'USD',
      status: 'draft',
    });
    expect(valid.success).toBe(true);

    expect(
      proposalLineItemSchema.safeParse({
        description: 'Design',
        quantity: '2',
        unitPrice: '500.00',
        taxRate: '10',
      }).success
    ).toBe(true);
    expect(
      proposalLineItemSchema.safeParse({
        description: 'Invalid negative qty',
        quantity: '-1',
        unitPrice: '500.00',
        taxRate: '10',
      }).success
    ).toBe(false);
  });

  it('validates proposal and quotation status enums including expired', () => {
    expect(proposalUpdateSchema.safeParse({ status: 'expired' }).success).toBe(true);
    expect(proposalUpdateSchema.safeParse({ status: 'bogus' }).success).toBe(false);
    expect(quotationUpdateSchema.safeParse({ status: 'accepted' }).success).toBe(true);
    expect(quotationUpdateSchema.safeParse({ status: 'unknown' }).success).toBe(false);
    expect(quotationCreateSchema.safeParse({ title: 'Q4 Retainer' }).success).toBe(true);
    expect(
      quotationLineItemSchema.safeParse({
        description: 'Retainer',
        quantity: '1',
        unitPrice: '1500.00',
        taxRate: '0',
      }).success
    ).toBe(true);
  });

  it('enforces estimate status enum, blocks direct converted mutation, and rejects spoofed fields', () => {
    expect(
      estimateCreateSchema.safeParse({
        clientId: SAMPLE_CUID,
        number: 'EST-2026-0001',
        status: 'draft',
        total: '1250.00',
      }).success
    ).toBe(true);

    expect(
      estimateCreateSchema.safeParse({
        clientId: SAMPLE_CUID,
        number: 'EST-2026-0001',
        status: 'invalid_status',
        total: '1250.00',
      }).success
    ).toBe(false);

    // Direct PUT to status='converted' is blocked; conversion must go through /convert
    expect(estimateUpdateSchema.safeParse({ status: 'converted' }).success).toBe(false);
    expect(estimateUpdateSchema.safeParse({ status: 'accepted' }).success).toBe(true);
    expect(
      estimateUpdateSchema.safeParse({
        status: 'sent',
        organizationId: 'org-spoof',
      }).success
    ).toBe(false);
  });

  it('requires signerName and valid signerEmail when signing contracts', () => {
    expect(
      contractSignSchema.safeParse({
        signerName: '',
        signerEmail: '',
      }).success
    ).toBe(false);

    expect(
      contractSignSchema.safeParse({
        signerName: 'Jane Client',
        signerEmail: 'jane@client.example',
        signatureReference: 'esign-ref-001',
      }).success
    ).toBe(true);

    expect(
      contractCreateSchema.safeParse({
        title: 'MSA 2026',
        organizationId: 'spoof',
      }).success
    ).toBe(false);

    expect(contractUpdateSchema.safeParse({ status: 'voided' }).success).toBe(true);
  });

  it('validates document templates without clobbering isDefault on partial update', () => {
    expect(
      templateCreateSchema.safeParse({
        name: 'Agency Retainer',
        type: 'proposal',
        content: 'Prepared for {{client_name}}',
        variables: { client_name: '' },
        isDefault: true,
      }).success
    ).toBe(true);

    expect(templateUpdateSchema.safeParse({}).success).toBe(false);
    const partial = templateUpdateSchema.safeParse({ name: 'Renamed Template' });
    expect(partial.success).toBe(true);
    if (partial.success) {
      expect(partial.data.isDefault).toBeUndefined();
    }

    expect(
      salesDocumentShareLinkCreateSchema.safeParse({
        entityType: 'proposal',
        entityId: SAMPLE_CUID,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        maxAccess: 5,
      }).success
    ).toBe(true);

    expect(
      salesDocumentShareLinkCreateSchema.safeParse({
        entityType: 'secret_table',
        entityId: SAMPLE_CUID,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      }).success
    ).toBe(false);
  });

  it('includes document, contract, and template permissions in organization bootstrap', () => {
    const bootstrapSource = fs.readFileSync(
      path.join(process.cwd(), 'app/api/auth/bootstrap-organization/route.ts'),
      'utf8'
    );
    const requiredCodes = [
      'proposal.create',
      'proposal.read',
      'quotation.create',
      'quotation.read',
      'estimate.create',
      'estimate.update',
      'invoice.create',
      'contract.create',
      'contract.read',
      'contract.sign',
      'document.create',
      'document.read',
      'document.share',
      'template.create',
      'template.read',
    ];
    for (const code of requiredCodes) {
      expect(bootstrapSource).toContain(`'${code}'`);
    }
  });
});
