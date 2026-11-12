// @vitest-environment node

/**
 * E-mail configuration (`lib/email/config.ts`).
 *
 * Two properties are pinned here: delivery is off unless it is switched on
 * explicitly, and once it is on, anything short of a complete and safe
 * configuration disables sending instead of degrading it.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspect } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadEmailConfig, type EmailConfig, type EmailSettings } from '@/lib/email/config';

const PASSWORD = 'correct-horse-battery-staple';

const VALID = {
  EMAIL_TRANSPORT: 'smtp',
  SMTP_HOST: 'smtp.example.test',
  SMTP_USER: 'mailer-user',
  SMTP_PASS: PASSWORD,
  EMAIL_FROM_ADDRESS: 'no-reply@example.test',
  BETTER_AUTH_URL: 'https://app.example.test',
} as const;

type Env = Record<string, string | undefined>;

function load(overrides: Env = {}): EmailConfig {
  return loadEmailConfig({ ...VALID, ...overrides });
}

function settings(overrides: Env = {}): EmailSettings {
  const config = load(overrides);
  if (config.mode !== 'smtp') {
    throw new Error(`expected a valid configuration, got ${JSON.stringify(config)}`);
  }
  return config.settings;
}

function problems(overrides: Env): string[] {
  const config = load(overrides);
  if (config.mode !== 'invalid') {
    throw new Error(`expected an invalid configuration, got mode "${config.mode}"`);
  }
  return config.problems;
}

let tempDir: string;
let caFile: string;

beforeAll(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'email-config-'));
  caFile = path.join(tempDir, 'ca.pem');
  writeFileSync(caFile, '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n');
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('delivery is off by default', () => {
  it('is disabled when nothing is configured', () => {
    expect(loadEmailConfig({})).toEqual({ mode: 'disabled' });
  });

  it('stays disabled when SMTP settings exist but the transport was not selected', () => {
    // Leftover or half-finished settings must never start sending on their own.
    const leftover: Env = { ...VALID };
    delete leftover.EMAIL_TRANSPORT;
    expect(loadEmailConfig(leftover)).toEqual({ mode: 'disabled' });
  });

  it.each(['', '   ', 'disabled', 'DISABLED', ' Disabled '])(
    'is disabled for EMAIL_TRANSPORT=%j',
    (value) => {
      expect(load({ EMAIL_TRANSPORT: value })).toEqual({ mode: 'disabled' });
    }
  );

  it.each(['true', '1', 'on', 'sendmail', 'console', 'log', 'smtps', 'smtp://host'])(
    'refuses the unknown transport %j instead of guessing',
    (value) => {
      expect(load({ EMAIL_TRANSPORT: value })).toEqual({
        mode: 'invalid',
        problems: ['EMAIL_TRANSPORT must be "smtp" or "disabled"'],
      });
    }
  );
});

describe('a valid SMTP configuration', () => {
  it('uses STARTTLS on 587 by default, with bounded timeouts and retries', () => {
    expect(settings()).toEqual({
      appUrl: 'https://app.example.test',
      from: { name: 'AgencyOS', address: 'no-reply@example.test' },
      maxAttempts: 2,
      retryDelayMs: 500,
      smtp: {
        host: 'smtp.example.test',
        port: 587,
        implicitTls: false,
        connectTimeoutMs: 5000,
        attemptTimeoutMs: 10000,
      },
    });
  });

  it('accepts the optional settings', () => {
    const result = settings({
      SMTP_PORT: '2525',
      SMTP_TLS_CA_FILE: caFile,
      SMTP_TIMEOUT_MS: '4000',
      SMTP_MAX_ATTEMPTS: '3',
      EMAIL_FROM_NAME: 'Acme Portal',
      EMAIL_REPLY_TO: 'support@example.test',
    });

    expect(result.from).toEqual({ name: 'Acme Portal', address: 'no-reply@example.test' });
    expect(result.replyTo).toBe('support@example.test');
    expect(result.maxAttempts).toBe(3);
    expect(result.smtp.port).toBe(2525);
    expect(result.smtp.attemptTimeoutMs).toBe(4000);
    expect(result.smtp.connectTimeoutMs).toBe(2000);
    expect(result.smtp.ca).toContain('-----BEGIN CERTIFICATE-----');
  });

  it('accepts a relay without credentials', () => {
    const result = settings({ SMTP_USER: undefined, SMTP_PASS: undefined });
    expect(result.smtp.credentials).toBeUndefined();
  });

  it('keeps a password exactly as configured, including surrounding spaces', () => {
    expect(settings({ SMTP_PASS: '  spaced  ' }).smtp.credentials?.pass).toBe('  spaced  ');
  });

  it.each(['smtp.example.test', 'mail', 'mail_relay', '127.0.0.1', '::1', 'a-b.c-d.example'])(
    'accepts the host %j',
    (host) => {
      expect(settings({ SMTP_HOST: host }).smtp.host).toBe(host);
    }
  );
});

describe('TLS cannot be switched off', () => {
  it.each([
    [{}, { port: 587, implicitTls: false }],
    [{ SMTP_PORT: '465' }, { port: 465, implicitTls: true }],
    [{ SMTP_SECURE: 'true' }, { port: 465, implicitTls: true }],
    [
      { SMTP_SECURE: 'TRUE', SMTP_PORT: '2465' },
      { port: 2465, implicitTls: true },
    ],
    [{ SMTP_SECURE: 'false' }, { port: 587, implicitTls: false }],
    [
      { SMTP_SECURE: 'false', SMTP_PORT: '465' },
      { port: 465, implicitTls: false },
    ],
    [{ SMTP_PORT: '25' }, { port: 25, implicitTls: false }],
  ])('%j selects implicit TLS or mandatory STARTTLS', (env, expected) => {
    // `implicitTls: false` is not "no TLS": the transport then requires STARTTLS
    // (asserted against a real server in smtp-transport.test.ts).
    const { port, implicitTls } = settings(env).smtp;
    expect({ port, implicitTls }).toEqual(expected);
  });

  it('has no setting that weakens TLS or certificate verification', () => {
    const attempts: Env = {
      SMTP_TLS: 'false',
      SMTP_IGNORE_TLS: 'true',
      SMTP_REQUIRE_TLS: 'false',
      SMTP_TLS_REJECT_UNAUTHORIZED: 'false',
      SMTP_REJECT_UNAUTHORIZED: '0',
      SMTP_ALLOW_INSECURE: 'true',
      SMTP_INSECURE: '1',
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
    };
    expect(settings(attempts)).toEqual(settings());
  });

  it.each(['yes', '1', '0', 'starttls', 'none', 'off'])(
    'refuses SMTP_SECURE=%j rather than interpreting it',
    (value) => {
      expect(problems({ SMTP_SECURE: value })).toEqual(['SMTP_SECURE must be "true" or "false"']);
    }
  );

  it('refuses a CA file given as a relative path', () => {
    expect(problems({ SMTP_TLS_CA_FILE: 'certs/ca.pem' })).toEqual([
      'SMTP_TLS_CA_FILE must be an absolute path',
    ]);
  });

  it('refuses a CA file that cannot be read, instead of falling back to the default store', () => {
    expect(problems({ SMTP_TLS_CA_FILE: path.join(tempDir, 'missing.pem') })).toEqual([
      'SMTP_TLS_CA_FILE could not be read',
    ]);
  });

  it('refuses a CA file that is not a PEM certificate', () => {
    const notPem = path.join(tempDir, 'not-a-cert.txt');
    writeFileSync(notPem, 'hello');
    expect(problems({ SMTP_TLS_CA_FILE: notPem })).toEqual([
      'SMTP_TLS_CA_FILE does not contain a PEM certificate',
    ]);
  });
});

describe('fails closed on an incomplete or malformed configuration', () => {
  it.each([
    [{ SMTP_HOST: undefined }, 'SMTP_HOST is missing or is not a host name'],
    [{ SMTP_HOST: '' }, 'SMTP_HOST is missing or is not a host name'],
    [{ SMTP_HOST: 'smtp://smtp.example.test' }, 'SMTP_HOST is missing or is not a host name'],
    [{ SMTP_HOST: 'smtp.example.test:587' }, 'SMTP_HOST is missing or is not a host name'],
    [{ SMTP_HOST: 'user@smtp.example.test' }, 'SMTP_HOST is missing or is not a host name'],
    [{ SMTP_HOST: 'smtp.example.test/path' }, 'SMTP_HOST is missing or is not a host name'],
    [{ SMTP_HOST: 'smtp example' }, 'SMTP_HOST is missing or is not a host name'],
    [{ SMTP_PORT: '0' }, 'SMTP_PORT must be a port number'],
    [{ SMTP_PORT: '65536' }, 'SMTP_PORT must be a port number'],
    [{ SMTP_PORT: '-587' }, 'SMTP_PORT must be a port number'],
    [{ SMTP_PORT: '587.5' }, 'SMTP_PORT must be a port number'],
    [{ SMTP_PORT: '0x24b' }, 'SMTP_PORT must be a port number'],
    [{ SMTP_PORT: 'smtp' }, 'SMTP_PORT must be a port number'],
    [{ SMTP_PASS: undefined }, 'SMTP_USER and SMTP_PASS must be set together'],
    [{ SMTP_USER: undefined }, 'SMTP_USER and SMTP_PASS must be set together'],
    [{ SMTP_PASS: '' }, 'SMTP_USER and SMTP_PASS must be set together'],
    [
      { SMTP_PASS: `${PASSWORD}\n` },
      'SMTP_USER and SMTP_PASS must not contain line breaks or control characters',
    ],
    [
      { SMTP_USER: 'user\r\nRSET' },
      'SMTP_USER and SMTP_PASS must not contain line breaks or control characters',
    ],
    [
      { EMAIL_FROM_ADDRESS: undefined },
      'EMAIL_FROM_ADDRESS is missing or is not a valid e-mail address',
    ],
    [
      { EMAIL_FROM_ADDRESS: 'AgencyOS <no-reply@example.test>' },
      'EMAIL_FROM_ADDRESS is missing or is not a valid e-mail address',
    ],
    [
      { EMAIL_FROM_ADDRESS: 'no-reply@example.test,attacker@evil.example' },
      'EMAIL_FROM_ADDRESS is missing or is not a valid e-mail address',
    ],
    [
      { EMAIL_FROM_ADDRESS: 'no-reply@localhost' },
      'EMAIL_FROM_ADDRESS is missing or is not a valid e-mail address',
    ],
    [
      { EMAIL_FROM_NAME: 'Acme\r\nBcc: attacker@evil.example' },
      'EMAIL_FROM_NAME must be a single line of at most 100 characters',
    ],
    [
      { EMAIL_FROM_NAME: 'A'.repeat(101) },
      'EMAIL_FROM_NAME must be a single line of at most 100 characters',
    ],
    [{ EMAIL_REPLY_TO: 'not-an-address' }, 'EMAIL_REPLY_TO is not a valid e-mail address'],
    [
      { EMAIL_REPLY_TO: 'support@example.test\nBcc: attacker@evil.example' },
      'EMAIL_REPLY_TO is not a valid e-mail address',
    ],
    [{ SMTP_TIMEOUT_MS: '999' }, 'SMTP_TIMEOUT_MS must be between 1000 and 30000'],
    [{ SMTP_TIMEOUT_MS: '30001' }, 'SMTP_TIMEOUT_MS must be between 1000 and 30000'],
    [{ SMTP_TIMEOUT_MS: '0' }, 'SMTP_TIMEOUT_MS must be between 1000 and 30000'],
    [{ SMTP_TIMEOUT_MS: 'never' }, 'SMTP_TIMEOUT_MS must be between 1000 and 30000'],
    [{ SMTP_MAX_ATTEMPTS: '0' }, 'SMTP_MAX_ATTEMPTS must be between 1 and 3'],
    [{ SMTP_MAX_ATTEMPTS: '4' }, 'SMTP_MAX_ATTEMPTS must be between 1 and 3'],
    [{ SMTP_MAX_ATTEMPTS: '-1' }, 'SMTP_MAX_ATTEMPTS must be between 1 and 3'],
    [{ SMTP_MAX_ATTEMPTS: 'Infinity' }, 'SMTP_MAX_ATTEMPTS must be between 1 and 3'],
  ] as Array<[Env, string]>)('%j is refused', (env, problem) => {
    expect(problems(env)).toEqual([problem]);
  });

  it('reports every problem at once', () => {
    expect(
      problems({ SMTP_HOST: '', SMTP_PORT: 'x', SMTP_PASS: undefined, EMAIL_FROM_ADDRESS: 'nope' })
    ).toEqual([
      'SMTP_HOST is missing or is not a host name',
      'SMTP_PORT must be a port number',
      'SMTP_USER and SMTP_PASS must be set together',
      'EMAIL_FROM_ADDRESS is missing or is not a valid e-mail address',
    ]);
  });
});

describe('the origin of links', () => {
  const APP_URL_PROBLEM =
    'BETTER_AUTH_URL (or NEXT_PUBLIC_APP_URL) must be the https:// origin of the application; http:// is accepted for localhost only';

  it('uses BETTER_AUTH_URL, reduced to its origin', () => {
    expect(settings({ BETTER_AUTH_URL: 'https://app.example.test/some/path?x=1#y' }).appUrl).toBe(
      'https://app.example.test'
    );
    expect(settings({ BETTER_AUTH_URL: 'https://app.example.test:8443/' }).appUrl).toBe(
      'https://app.example.test:8443'
    );
  });

  it('falls back to NEXT_PUBLIC_APP_URL, and prefers BETTER_AUTH_URL when both are set', () => {
    expect(
      settings({ BETTER_AUTH_URL: undefined, NEXT_PUBLIC_APP_URL: 'https://public.example.test' })
        .appUrl
    ).toBe('https://public.example.test');
    expect(
      settings({ BETTER_AUTH_URL: '  ', NEXT_PUBLIC_APP_URL: 'https://public.example.test' }).appUrl
    ).toBe('https://public.example.test');
    expect(settings({ NEXT_PUBLIC_APP_URL: 'https://public.example.test' }).appUrl).toBe(
      'https://app.example.test'
    );
  });

  it.each(['http://localhost:3001', 'http://127.0.0.1:3001', 'http://[::1]:3001'])(
    'accepts plain http for the loopback origin %s',
    (url) => {
      expect(settings({ BETTER_AUTH_URL: url }).appUrl).toBe(url);
    }
  );

  it('never invents an origin: without one configured, nothing is sent', () => {
    // Better Auth falls back to http://localhost:3001; an e-mailed link must not.
    expect(problems({ BETTER_AUTH_URL: undefined })).toEqual([APP_URL_PROBLEM]);
  });

  it.each([
    ['plain http on a public host', 'http://app.example.test'],
    ['plain http on a host that only looks local', 'http://localhost.evil.example'],
    ['plain http on a private address', 'http://192.168.1.10:3001'],
    ['embedded credentials', 'https://user:secret@app.example.test'],
    ['a non-http scheme', 'ftp://app.example.test'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a bare host name', 'app.example.test'],
    ['a relative path', '/portal'],
  ])('refuses %s', (_label, url) => {
    expect(problems({ BETTER_AUTH_URL: url })).toEqual([APP_URL_PROBLEM]);
  });

  it('does not fall through to NEXT_PUBLIC_APP_URL when BETTER_AUTH_URL is set but unsafe', () => {
    expect(
      problems({
        BETTER_AUTH_URL: 'http://app.example.test',
        NEXT_PUBLIC_APP_URL: 'https://public.example.test',
      })
    ).toEqual([APP_URL_PROBLEM]);
  });
});

describe('secrets stay out of anything that could be logged', () => {
  it('keeps the credentials out of JSON, console output and enumeration', () => {
    const config = load();
    const result = settings();

    expect(result.smtp.credentials).toEqual({ user: 'mailer-user', pass: PASSWORD });
    expect(JSON.stringify(config)).not.toContain(PASSWORD);
    expect(JSON.stringify(config)).not.toContain('mailer-user');
    expect(inspect(config, { depth: 10 })).not.toContain(PASSWORD);
    expect(Object.keys(result.smtp)).not.toContain('credentials');
    expect({ ...result.smtp }).not.toHaveProperty('credentials');
  });

  it('does not let the credentials be changed after loading', () => {
    const { credentials } = settings().smtp;
    expect(Object.isFrozen(credentials)).toBe(true);
  });

  it('names the variable at fault and never echoes a value', () => {
    const secretLooking = {
      SMTP_HOST: 'host with secret-value-1',
      SMTP_PORT: 'secret-value-2',
      SMTP_USER: 'secret-value-3\n',
      SMTP_PASS: 'secret-value-4\n',
      SMTP_SECURE: 'secret-value-5',
      SMTP_TLS_CA_FILE: '/secret-value-6/ca.pem',
      SMTP_TIMEOUT_MS: 'secret-value-7',
      SMTP_MAX_ATTEMPTS: 'secret-value-8',
      EMAIL_FROM_ADDRESS: 'secret-value-9',
      EMAIL_FROM_NAME: 'secret-value-10\nsecond line',
      EMAIL_REPLY_TO: 'secret-value-11',
      BETTER_AUTH_URL: 'http://secret-value-12.example',
    };
    const reported = problems(secretLooking);

    // One problem per variable (the two credentials share one).
    expect(reported.length).toBe(Object.keys(secretLooking).length - 1);
    expect(reported.join('\n')).not.toContain('secret-value');
    expect(reported.join('\n')).not.toContain('second line');
  });
});
