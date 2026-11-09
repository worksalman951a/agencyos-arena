/**
 * Shared parsers for URL query parameters.
 *
 * Why this exists
 * ---------------
 * `z.coerce.boolean()` applies JavaScript's `Boolean(value)` to the raw query
 * string. Because every non-empty string is truthy, `Boolean("false")` is
 * `true`. A client asking for `/api/v1/crm/contacts?includeDeleted=false`
 * therefore received **soft-deleted records**, the opposite of what it asked
 * for. That made deleted contacts (and accounts, leads, opportunities,
 * pipelines, pipeline stages, proposals, quotations, invoices and projects)
 * appear in ordinary lists, and their detail pages displayed a populated
 * "Deleted At" date.
 *
 * The parser below accepts an explicit, documented set of true/false tokens.
 * Anything else is rejected so a typo cannot silently flip the meaning of a
 * query. Omitting the parameter is `false`, which keeps soft-deleted records
 * out of ordinary lists by default.
 */

import { z } from 'zod';

/** Tokens that mean `true` (case-insensitive, surrounding whitespace ignored). */
const TRUE_TOKENS = new Set(['true', '1', 'yes', 'on']);

/** Tokens that mean `false` (case-insensitive, surrounding whitespace ignored). */
const FALSE_TOKENS = new Set(['false', '0', 'no', 'off', '']);

/**
 * Strict boolean query-parameter parser.
 *
 * - `"true" | "1" | "yes" | "on"` -> `true`
 * - `"false" | "0" | "no" | "off" | ""` -> `false`
 * - omitted / `undefined` / `null` -> `false` (safe default: exclude deleted)
 * - real booleans and numbers `1` / `0` (non-HTTP callers, tests) -> `true` / `false`
 * - anything else -> validation error (`400 Invalid query parameters`)
 */
export const queryBoolean = z.preprocess((value) => {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (TRUE_TOKENS.has(normalized)) return true;
    if (FALSE_TOKENS.has(normalized)) return false;
  }
  // Unknown token: return it unchanged so z.boolean() reports a validation error.
  return value;
}, z.boolean());

/**
 * `includeDeleted` for list/query schemas.
 *
 * Default `false`: ordinary lists never contain soft-deleted records unless the
 * caller explicitly asks for them with `?includeDeleted=true`. Records and their
 * `deletedAt` timestamps are only ever read here — this parser never restores,
 * clears or hard-deletes anything.
 */
export const includeDeletedQueryParam = queryBoolean;
