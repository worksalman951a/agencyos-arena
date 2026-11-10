/**
 * Document numbering (pure parts).
 *
 * The atomic allocation itself needs a database and is covered by the
 * integration suite; here we pin the number format, the sequence parser and the
 * guards that stop a malformed setting from producing a duplicate or a reset.
 */

import { describe, expect, it } from 'vitest';

import {
  SEQUENCE_WIDTH,
  formatDocumentNumber,
  parseSequenceFromNumber,
} from '@/lib/services/settings/document-number-format';

describe('formatDocumentNumber', () => {
  it('pads the sequence and includes the year', () => {
    expect(formatDocumentNumber('INV', 1, 2026)).toBe('INV-2026-0001');
    expect(formatDocumentNumber('PRP', 1234, 2026)).toBe('PRP-2026-1234');
  });

  it('does not truncate sequences that outgrow the padding', () => {
    expect(formatDocumentNumber('INV', 123456, 2026)).toBe('INV-2026-123456');
    expect(SEQUENCE_WIDTH).toBe(4);
  });
});

describe('parseSequenceFromNumber', () => {
  it('reads the trailing sequence', () => {
    expect(parseSequenceFromNumber('INV-2026-0007')).toBe(7);
    expect(parseSequenceFromNumber('PRP-2025-123456')).toBe(123456);
    expect(parseSequenceFromNumber('  INV-2026-0009  ')).toBe(9);
  });

  it('returns null when there is no sequence to read', () => {
    expect(parseSequenceFromNumber('INV-2026-')).toBeNull();
    expect(parseSequenceFromNumber('INVOICE')).toBeNull();
    expect(parseSequenceFromNumber(null)).toBeNull();
    expect(parseSequenceFromNumber(undefined)).toBeNull();
  });

  it('round-trips with formatDocumentNumber', () => {
    const formatted = formatDocumentNumber('QOT', 42, 2026);
    expect(parseSequenceFromNumber(formatted)).toBe(42);
  });
});

describe('allocator contract (static guards)', () => {
  it('names the columns and tables the allocator relies on', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync('lib/services/settings/document-numbering.ts', 'utf8')
    );

    // Settings keys that hold the counters, and the tables they seed from.
    for (const token of [
      'invoiceNextNumber',
      'proposalNextNumber',
      'invoiceNumberPrefix',
      'proposalNumberPrefix',
      "'Invoice'",
      "'Proposal'",
    ]) {
      expect(source).toContain(token);
    }

    // Atomicity: the counter is advanced with a single jsonb_set UPDATE.
    expect(source).toContain('jsonb_set');
    expect(source).toContain('RETURNING');
    // Never renumber existing documents.
    expect(source).not.toContain('UPDATE "Invoice"');
    expect(source).not.toContain('UPDATE "Proposal"');

    // The reserved sequence is floored at "highest existing + 1", so lowering the
    // counter in Settings cannot rewind onto an already issued number.
    expect(source).toContain('GREATEST(');
    expect(source).toContain('highestExistingSequence');
  });
});
