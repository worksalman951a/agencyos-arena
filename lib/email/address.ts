/**
 * Address and header-text validation for outgoing e-mail (pure module).
 *
 * Anything that ends up in a message header or in the SMTP envelope passes
 * through here first. The rules are stricter than RFC 5322 on purpose: quoted
 * local parts, comments, address lists, display names and non-ASCII mailboxes
 * are all refused, because none of them is needed for a transactional message
 * and each one is a way to smuggle a second recipient or a header line.
 */

const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;

/** At least two labels; the last one starts with a letter (no IP literals, no bare hosts). */
const DOMAIN =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/**
 * `true` for a single bare mailbox such as `name@example.com`.
 *
 * Whitespace, control characters, angle brackets, commas, semicolons and quotes
 * can never match, so a value that passes cannot contain a line break (header
 * injection) or more than one address.
 */
export function isDeliverableAddress(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 254) return false;
  const at = value.lastIndexOf('@');
  if (at < 1) return false;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  return local.length <= 64 && LOCAL_PART.test(local) && DOMAIN.test(domain);
}

/**
 * Control characters (including CR and LF), Unicode line separators and
 * bidirectional overrides. The first two can start a new header line; the last
 * can make displayed text read differently from what was written.
 */
const UNSAFE_HEADER_CHARACTERS =
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
const UNSAFE_HEADER_CHARACTERS_ALL = new RegExp(UNSAFE_HEADER_CHARACTERS.source, 'g');

/** `true` when `value` could be placed in a header as it is. */
export function isSingleLine(value: string): boolean {
  return !UNSAFE_HEADER_CHARACTERS.test(value);
}

/**
 * Reduce untrusted text (an organization name, a contact name) to one line of
 * at most `maxLength` characters: unsafe characters become spaces, runs of
 * whitespace collapse, and the result is trimmed.
 */
export function singleLine(value: string | null | undefined, maxLength: number): string {
  const flattened = (value ?? '')
    .replace(UNSAFE_HEADER_CHARACTERS_ALL, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Slice by code point so a surrogate pair is never cut in half.
  return Array.from(flattened).slice(0, maxLength).join('').trim();
}
