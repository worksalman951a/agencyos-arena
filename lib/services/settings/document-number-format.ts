/**
 * Document number formatting — no database imports, safe to unit test.
 *
 * Numbers look like `PREFIX-YYYY-NNNN`: the organization's prefix, the year the
 * document is created in, and a zero-padded sequence that only ever increases.
 */

export const SEQUENCE_WIDTH = 4;

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
