// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTestCertificate,
  parseMessage,
  startMockSmtpServer,
  type MockSmtpServer,
  type TestCertificate,
} from './mock-smtp-server';

const queryRaw = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: { $queryRawUnsafe: (...args: unknown[]) => queryRaw(...args) },
}));

const { sendEmailVerificationEmail } = await import('@/lib/email/email-verification-emails');
let certificate: TestCertificate;
let server: MockSmtpServer | null = null;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  certificate = createTestCertificate();
});
afterAll(() => certificate.cleanup());

beforeEach(() => {
  queryRaw.mockReset().mockResolvedValue([{ count: 1, retry_after: 0 }]);
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (server) await server.close();
  server = null;
});

describe('email ownership SMTP delivery', () => {
  it('sends the verification link over the shared SMTP transport without logging the token', async () => {
    server = await startMockSmtpServer({ cert: certificate.cert, key: certificate.key });
    const token = 'A'.repeat(43);
    const env: Record<string, string> = {
      EMAIL_TRANSPORT: 'smtp',
      SMTP_HOST: 'localhost',
      SMTP_PORT: String(server.port),
      SMTP_TLS_CA_FILE: certificate.certFile,
      SMTP_TIMEOUT_MS: '3000',
      SMTP_MAX_ATTEMPTS: '1',
      EMAIL_FROM_ADDRESS: 'no-reply@example.test',
      EMAIL_FROM_NAME: 'AgencyOS',
      BETTER_AUTH_URL: 'https://app.example.test',
    };
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);

    const result = await sendEmailVerificationEmail({
      to: 'owner@example.test',
      token,
      expiresAt: new Date('2026-11-12T18:40:00.000Z'),
    });

    expect(result.status).toBe('sent');
    expect(server.messages).toHaveLength(1);
    const message = parseMessage(server.messages[0].raw);
    expect(server.messages[0].to).toEqual(['owner@example.test']);
    expect(message.headers.subject).toBe('Verify your AgencyOS email address');
    expect(message.text).toContain(`https://app.example.test/verify-email#${token}`);
    expect(message.html).toContain(`#${token}`);
    expect(message.text).not.toContain('?token=');
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(token);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });
});
