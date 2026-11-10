/**
 * Document numbering (invoices and proposals).
 *
 * Numbers follow `PREFIX-YYYY-NNNN`, where:
 *  - PREFIX is the organization's configured prefix (INV / PRP by default),
 *  - YYYY is the year the document is created in,
 *  - NNNN is the organization's next-number counter, zero padded.
 *
 * The counter lives in `Organization.settings` as `invoiceNextNumber` /
 * `proposalNextNumber` and is advanced **inside the caller's transaction**, with
 * a single atomic `UPDATE … jsonb_set(…) RETURNING` on the organization row:
 *
 *  - concurrent creations serialise on that row lock, so two requests can never
 *    receive the same sequence value;
 *  - because the increment shares the document's transaction, a rollback also
 *    rolls back the counter (no gaps from failed creates);
 *  - existing documents are never renumbered; when the counter is missing or
 *    malformed it is seeded from the highest sequence already in use, so an
 *    upgraded database continues where it left off instead of restarting at 1.
 *
 * A bounded collision check remains as a safety net for data that drifted
 * outside the app (for example a document imported with a number ahead of the
 * counter): the next free number is used instead of overwriting anything.
 */

import { prisma } from '@/lib/db';
import { normalizeOrganizationSettings } from '@/lib/schemas/settings/organization.schema';

export type DocumentKind = 'invoice' | 'proposal';

/**
 * Prisma transaction client. `prisma` itself is intentionally typed loosely in
 * lib/db.ts (it is assigned through `globalThis` for hot-reload reuse), so the
 * transaction client follows the same convention the other services use.
 */
export type PrismaTransactionClient = typeof prisma;

interface KindConfig {
  /** Settings key holding the next sequence value. */
  counterKey: 'invoiceNextNumber' | 'proposalNextNumber';
  /** Settings key holding the prefix. */
  prefixKey: 'invoiceNumberPrefix' | 'proposalNumberPrefix';
  /** Table used for the "highest existing sequence" seed. */
  table: 'Invoice' | 'Proposal';
  /** Prefix used when the organization has none configured. */
  defaultPrefix: string;
  /** Human label for error messages. */
  label: string;
}

const KINDS: Record<DocumentKind, KindConfig> = {
  invoice: {
    counterKey: 'invoiceNextNumber',
    prefixKey: 'invoiceNumberPrefix',
    table: 'Invoice',
    defaultPrefix: 'INV',
    label: 'invoice',
  },
  proposal: {
    counterKey: 'proposalNextNumber',
    prefixKey: 'proposalNumberPrefix',
    table: 'Proposal',
    defaultPrefix: 'PRP',
    label: 'proposal',
  },
};

export const SEQUENCE_WIDTH = 4;
const MAX_COLLISION_RETRIES = 5;

/** `INV` + 2026 + 12 → `INV-2026-0012`. */
export function formatDocumentNumber(prefix: string, sequence: number, year: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(SEQUENCE_WIDTH, '0')}`;
}

/** Parse the trailing sequence out of a document number, or null. */
export function parseSequenceFromNumber(number: string | null | undefined): number | null {
  if (!number) return null;
  const match = /(\d+)\s*$/.exec(number.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

/**
 * Highest sequence already used for `prefix` in this organization.
 * Uses the database so a large ledger is not loaded into memory.
 */
async function highestExistingSequence(
  tx: PrismaTransactionClient,
  table: KindConfig['table'],
  organizationId: string,
  prefix: string
): Promise<number> {
  const rows = (await tx.$queryRawUnsafe(
    `SELECT COALESCE(MAX((substring("number" from '([0-9]+)$'))::int), 0) AS max_seq
       FROM "${table}"
      WHERE "organizationId" = $1
        AND "number" LIKE $2 || '-%'`,
    organizationId,
    prefix
  )) as Array<{ max_seq: number | null }>;

  const value = rows[0]?.max_seq;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Atomically reserve the next sequence value and return it.
 *
 * `fallback` is used only when the stored counter is absent or malformed, and is
 * always at least one higher than any number already used.
 */
async function reserveSequence(
  tx: PrismaTransactionClient,
  organizationId: string,
  key: KindConfig['counterKey'],
  fallback: number
): Promise<number> {
  const rows = (await tx.$queryRawUnsafe(
    `UPDATE "Organization"
        SET "settings" = jsonb_set(
              COALESCE("settings", '{}'::jsonb),
              ARRAY[$2]::text[],
              to_jsonb(
                COALESCE(
                  CASE WHEN "settings"->>$2 ~ '^[0-9]{1,9}$' THEN ("settings"->>$2)::int END,
                  $3::int
                ) + 1
              ),
              true
            ),
            "updatedAt" = now()
      WHERE "id" = $1
      RETURNING ("settings"->>$2)::int AS next_value`,
    organizationId,
    key,
    fallback
  )) as Array<{ next_value: number | null }>;

  const nextValue = rows[0]?.next_value;
  if (typeof nextValue !== 'number' || !Number.isFinite(nextValue)) {
    throw new Error(`Could not allocate a ${key} for organization ${organizationId}`);
  }

  // The stored value is the *next* one to use, so the value reserved for this
  // document is one less.
  return nextValue - 1;
}

/** Is this document number already taken in the organization? */
async function numberExists(
  tx: PrismaTransactionClient,
  kind: DocumentKind,
  organizationId: string,
  number: string
): Promise<boolean> {
  const existing =
    kind === 'invoice'
      ? await tx.invoice.findFirst({ where: { organizationId, number }, select: { id: true } })
      : await tx.proposal.findFirst({ where: { organizationId, number }, select: { id: true } });

  return existing !== null;
}

export interface AllocatedNumber {
  number: string;
  sequence: number;
  prefix: string;
}

/**
 * Reserve the next document number for an organization.
 *
 * Must be called inside the same transaction as the document insert, so the
 * counter increment and the document commit (or roll back) together.
 */
export async function allocateDocumentNumber(
  tx: PrismaTransactionClient,
  organizationId: string,
  kind: DocumentKind,
  now: Date = new Date()
): Promise<AllocatedNumber> {
  const config = KINDS[kind];

  const organization = await tx.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  });
  if (!organization) {
    const error = new Error('Organization not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  const settings = normalizeOrganizationSettings(organization.settings);
  const prefix = (settings[config.prefixKey] ?? config.defaultPrefix).toUpperCase();
  const seed = (await highestExistingSequence(tx, config.table, organizationId, prefix)) + 1;
  const year = now.getFullYear();

  for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
    const sequence = await reserveSequence(
      tx,
      organizationId,
      config.counterKey,
      Math.max(seed, settings[config.counterKey] ?? 1)
    );
    const number = formatDocumentNumber(prefix, sequence, year);

    if (!(await numberExists(tx, kind, organizationId, number))) {
      return { number, sequence, prefix };
    }
    // Number already used by a record the counter did not know about: keep the
    // counter moving rather than overwriting an issued document.
  }

  const error = new Error(
    `Could not allocate a unique ${config.label} number after ${MAX_COLLISION_RETRIES} attempts`
  ) as Error & { statusCode?: number };
  error.statusCode = 409;
  throw error;
}

export interface NumberingPreview {
  prefix: string;
  /** Sequence value that the next document will use. */
  nextSequence: number;
  /** Full number the next document will receive, e.g. `INV-2026-0004`. */
  preview: string;
}

/**
 * The number the next document will get, for display in Settings.
 * Read-only: never reserves or increments anything.
 */
export async function previewNextDocumentNumber(
  organizationId: string,
  kind: DocumentKind,
  settings: Record<string, unknown>,
  now: Date = new Date()
): Promise<NumberingPreview> {
  const config = KINDS[kind];
  const normalized = normalizeOrganizationSettings(settings);
  const prefix = (normalized[config.prefixKey] ?? config.defaultPrefix).toUpperCase();

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT COALESCE(MAX((substring("number" from '([0-9]+)$'))::int), 0) AS max_seq
       FROM "${config.table}"
      WHERE "organizationId" = $1
        AND "number" LIKE $2 || '-%'`,
    organizationId,
    prefix
  )) as Array<{ max_seq: number | null }>;

  const highest = rows[0]?.max_seq ?? 0;
  const configured = normalized[config.counterKey] ?? 1;
  // Show what will actually be used: the configured counter, unless the ledger
  // is already ahead of it (the allocator seeds from the highest existing).
  const nextSequence = Math.max(configured, highest + 1);

  return {
    prefix,
    nextSequence,
    preview: formatDocumentNumber(prefix, nextSequence, now.getFullYear()),
  };
}
