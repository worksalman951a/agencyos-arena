// @vitest-environment node

/**
 * Address and header-text validation (`lib/email/address.ts`).
 *
 * Everything that reaches a message header or the SMTP envelope passes through
 * these functions, so this is where header injection and "one recipient became
 * two" are ruled out.
 */

import { describe, expect, it } from 'vitest';

import { isDeliverableAddress, isSingleLine, singleLine } from '@/lib/email/address';

describe('isDeliverableAddress', () => {
  it.each([
    'client@example.com',
    'first.last@example.co.uk',
    'user+tag@sub.example.org',
    "o'brien@example.com",
    'UPPER@Example.COM',
    'a@b.co',
    'x_y-z@mail-server.example',
  ])('accepts %s', (address) => {
    expect(isDeliverableAddress(address)).toBe(true);
  });

  it.each([
    ['a line feed', 'client@example.com\nBcc: attacker@evil.example'],
    ['a carriage return and line feed', 'client@example.com\r\nBcc: attacker@evil.example'],
    ['an encoded-looking header after a space', 'client@example.com Bcc:attacker@evil.example'],
    ['a NUL byte', 'client@example.com\u0000'],
    ['a tab', 'client@example.com\t'],
    ['a Unicode line separator', 'client@example.com\u2028'],
  ])('rejects %s (header injection)', (_label, address) => {
    expect(isDeliverableAddress(address)).toBe(false);
  });

  it.each([
    ['a comma-separated list', 'client@example.com,attacker@evil.example'],
    ['a semicolon-separated list', 'client@example.com;attacker@evil.example'],
    ['a display name', 'Client <client@example.com>'],
    ['angle brackets', '<client@example.com>'],
    ['a quoted local part', '"client,attacker@evil.example"@example.com'],
    ['a comment', 'client(comment)@example.com'],
    ['a group', 'undisclosed-recipients:;'],
    ['two at signs', 'client@evil.example@example.com'],
  ])('rejects %s (more than one bare mailbox)', (_label, address) => {
    expect(isDeliverableAddress(address)).toBe(false);
  });

  it.each([
    ['no at sign', 'client.example.com'],
    ['an empty local part', '@example.com'],
    ['an empty domain', 'client@'],
    ['a host without a dot', 'client@localhost'],
    ['an IPv4 literal', 'client@127.0.0.1'],
    ['a bracketed IP literal', 'client@[127.0.0.1]'],
    ['a leading dot', '.client@example.com'],
    ['consecutive dots', 'cli..ent@example.com'],
    ['a domain label starting with a hyphen', 'client@-example.com'],
    ['a numeric top-level label', 'client@example.123'],
    ['surrounding whitespace', ' client@example.com '],
    ['a non-ASCII local part', 'clíent@example.com'],
    ['a non-ASCII domain', 'client@exämple.com'],
    ['a homoglyph domain', 'client@еxample.com'],
    ['the empty string', ''],
  ])('rejects %s', (_label, address) => {
    expect(isDeliverableAddress(address)).toBe(false);
  });

  it('rejects values that are not strings', () => {
    for (const value of [null, undefined, 42, {}, ['client@example.com']]) {
      expect(isDeliverableAddress(value)).toBe(false);
    }
  });

  it('enforces the RFC 5321 length limits', () => {
    const domain = 'example.com';
    expect(isDeliverableAddress(`${'a'.repeat(64)}@${domain}`)).toBe(true);
    expect(isDeliverableAddress(`${'a'.repeat(65)}@${domain}`)).toBe(false);

    const longDomain = `${Array.from({ length: 4 }, () => 'd'.repeat(60)).join('.')}.com`;
    expect(`a@${longDomain}`.length).toBeLessThanOrEqual(254);
    expect(isDeliverableAddress(`a@${longDomain}`)).toBe(true);
    expect(isDeliverableAddress(`${'a'.repeat(20)}@${longDomain}`)).toBe(false);
  });
});

describe('isSingleLine', () => {
  it('accepts ordinary text, including non-ASCII letters', () => {
    expect(isSingleLine('Invitation to the Müller & Søn client portal')).toBe(true);
  });

  it.each([
    ['LF', 'Subject\nBcc: attacker@evil.example'],
    ['CR', 'Subject\rBcc: attacker@evil.example'],
    ['CRLF', 'Subject\r\nBcc: attacker@evil.example'],
    ['NUL', 'Subject\u0000'],
    ['a C1 control (NEL)', 'Subject\u0085next'],
    ['a line separator', 'Subject\u2028next'],
    ['a paragraph separator', 'Subject\u2029next'],
    ['a right-to-left override', 'Subject \u202egnp.exe'],
    ['a bidi isolate', 'Subject \u2066hidden\u2069'],
  ])('rejects text containing %s', (_label, text) => {
    expect(isSingleLine(text)).toBe(false);
  });
});

describe('singleLine', () => {
  it('turns line breaks into spaces instead of keeping a second line', () => {
    const flattened = singleLine('Acme\r\nBcc: attacker@evil.example', 200);
    expect(flattened).toBe('Acme Bcc: attacker@evil.example');
    expect(isSingleLine(flattened)).toBe(true);
  });

  it('collapses whitespace and trims', () => {
    expect(singleLine('  Acme \t\n  Agency  ', 200)).toBe('Acme Agency');
  });

  it('removes bidirectional overrides', () => {
    expect(singleLine('Acme \u202eevil', 200)).toBe('Acme evil');
  });

  it('truncates to the limit without splitting a surrogate pair', () => {
    expect(singleLine('abcdef', 3)).toBe('abc');
    const truncated = singleLine('ab😀😀', 3);
    expect(truncated).toBe('ab😀');
    expect(truncated.isWellFormed()).toBe(true);
  });

  it('returns an empty string for null, undefined and blank input', () => {
    expect(singleLine(null, 10)).toBe('');
    expect(singleLine(undefined, 10)).toBe('');
    expect(singleLine(' \n\t ', 10)).toBe('');
  });

  it('always produces header-safe text, whatever the input', () => {
    const hostile = Array.from({ length: 0x200 }, (_unused, code) => String.fromCharCode(code));
    hostile.push('\u2028', '\u2029', '\u202a', '\u202e', '\u2066', '\u2069');
    expect(isSingleLine(singleLine(hostile.join('x'), 5000))).toBe(true);
  });
});
