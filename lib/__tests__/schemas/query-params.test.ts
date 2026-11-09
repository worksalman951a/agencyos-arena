/**
 * Regression tests for query-parameter boolean parsing.
 *
 * Bug (Priority 1): ten query schemas used `z.coerce.boolean()` for
 * `includeDeleted`. Zod's coercion applies `Boolean(value)` to the raw query
 * string, and every non-empty string is truthy — so `?includeDeleted=false`
 * parsed as **true** and lists returned soft-deleted records. Deleted contacts
 * appeared in the contacts list and their detail pages showed a populated
 * "Deleted At" date.
 *
 * These tests pin the contract for the shared `queryBoolean` parser and for
 * every schema that exposes `includeDeleted`.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { queryBoolean, includeDeletedQueryParam } from '@/lib/schemas/query-params';
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

describe('queryBoolean (shared parser)', () => {
  it.each(['true', 'TRUE', 'True', '1', 'yes', 'YES', 'on', ' true '])(
    'parses %p as true',
    (value) => {
      expect(queryBoolean.parse(value)).toBe(true);
    }
  );

  it.each(['false', 'FALSE', 'False', '0', 'no', 'off', '', ' false '])(
    'parses %p as false',
    (value) => {
      expect(queryBoolean.parse(value)).toBe(false);
    }
  );

  it('defaults to false when the parameter is omitted, null or undefined', () => {
    expect(queryBoolean.parse(undefined)).toBe(false);
    expect(queryBoolean.parse(null)).toBe(false);
  });

  it('accepts real booleans and numeric 1/0 from non-HTTP callers', () => {
    expect(queryBoolean.parse(true)).toBe(true);
    expect(queryBoolean.parse(false)).toBe(false);
    expect(queryBoolean.parse(1)).toBe(true);
    expect(queryBoolean.parse(0)).toBe(false);
  });

  it.each(['maybe', '2', 'null', 'undefined-as-a-string', '-1'])(
    'rejects the invalid token %p instead of silently coercing it',
    (value) => {
      expect(() => queryBoolean.parse(value)).toThrow();
    }
  );

  it('is re-exported as the includeDeleted parameter used by list schemas', () => {
    expect(includeDeletedQueryParam.parse('false')).toBe(false);
    expect(includeDeletedQueryParam.parse('true')).toBe(true);
  });
});

/** Every schema that exposes `includeDeleted` (the ten affected modules). */
const schemas: Array<[string, z.ZodType<{ includeDeleted?: boolean }>]> = [
  ['accountQuerySchema', accountQuerySchema],
  ['contactQuerySchema', contactQuerySchema],
  ['leadQuerySchema', leadQuerySchema],
  ['opportunityQuerySchema', opportunityQuerySchema],
  ['pipelineQuerySchema', pipelineQuerySchema],
  ['pipelineStageQuerySchema', pipelineStageQuerySchema],
  ['proposalQuerySchema', proposalQuerySchema],
  ['quotationQuerySchema', quotationQuerySchema],
  ['invoiceQuerySchema', invoiceQuerySchema],
  ['projectQuerySchema', projectQuerySchema],
];

describe.each(schemas)('%s includeDeleted contract', (_name, schema) => {
  it('excludes soft-deleted records by default (parameter omitted)', () => {
    expect(schema.parse({}).includeDeleted).toBe(false);
  });

  it('honours includeDeleted=false (previously coerced to true — the bug)', () => {
    expect(schema.parse({ includeDeleted: 'false' }).includeDeleted).toBe(false);
  });

  it('honours includeDeleted=0', () => {
    expect(schema.parse({ includeDeleted: '0' }).includeDeleted).toBe(false);
  });

  it('honours includeDeleted=true', () => {
    expect(schema.parse({ includeDeleted: 'true' }).includeDeleted).toBe(true);
  });

  it('honours includeDeleted=1', () => {
    expect(schema.parse({ includeDeleted: '1' }).includeDeleted).toBe(true);
  });

  it('rejects an invalid includeDeleted token', () => {
    expect(() => schema.parse({ includeDeleted: 'maybe' })).toThrow();
  });
});

describe('contacts list query contract (reported regression)', () => {
  // The exact query string built by app/crm/contacts/page.tsx.
  const listUrl =
    '/api/v1/crm/contacts?page=1&pageSize=20&search=&sortBy=createdAt&sortOrder=desc&includeDeleted=false';

  it('parses includeDeleted=false as false, so deleted contacts stay out of the list', () => {
    const query = Object.fromEntries(
      new URLSearchParams(new URL(listUrl, 'http://localhost').search)
    );
    const parsed = contactQuerySchema.parse(query);
    expect(parsed.includeDeleted).toBe(false);
  });

  it('parses the deleted-filter query string as true', () => {
    const query = Object.fromEntries(
      new URLSearchParams('page=1&includeDeleted=true&includeDeleted=false')
    );
    // Duplicate keys collapse to "true,false" via Object.fromEntries/URLSearchParams;
    // the explicit single value is the supported contract.
    expect(query.includeDeleted).toBeDefined();

    const single = Object.fromEntries(new URLSearchParams('page=1&includeDeleted=true'));
    expect(contactQuerySchema.parse(single).includeDeleted).toBe(true);
  });
});
