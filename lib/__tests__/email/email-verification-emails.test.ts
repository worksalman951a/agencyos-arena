import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendEmailMock = vi.fn();
const reserveMock = vi.fn();

vi.mock('@/lib/email/mailer', () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));
vi.mock('@/lib/email/sending-limit', () => ({
  reserveEmailVerificationEmail: (...args: unknown[]) => reserveMock(...args),
}));

const { sendEmailVerificationEmail } = await import('@/lib/email/email-verification-emails');

const token = 'AbCdEf0123456789_-AbCdEf0123456789_-AbCdEf0';
const expiresAt = new Date('2026-11-12T12:30:00.000Z');

beforeEach(() => {
  sendEmailMock.mockReset();
  reserveMock.mockReset();
  sendEmailMock.mockImplementation(async (compose: (link: (path: string) => string) => unknown) => {
    const message = compose((path) => `https://agency.example${path}`) as {
      to: string;
      subject: string;
      text: string;
      html: string;
    };
    expect(message.to).toBe('owner@example.test');
    expect(message.subject).toBe('Verify your AgencyOS email address');
    expect(message.text).toContain(`https://agency.example/verify-email#${token}`);
    expect(message.html).toContain(`#${token}`);
    expect(message.text).not.toContain('?token=');
    return { status: 'sent', messageId: 'safe-id', attempts: 1 };
  });
});

describe('sendEmailVerificationEmail', () => {
  it('composes a one-time email link with the token in the URL fragment', async () => {
    await expect(
      sendEmailVerificationEmail({ to: 'owner@example.test', token, expiresAt })
    ).resolves.toEqual({ status: 'sent', messageId: 'safe-id', attempts: 1 });
    expect(sendEmailMock).toHaveBeenCalledOnce();
    const options = sendEmailMock.mock.calls[0]?.[1] as { reserve: () => Promise<boolean> };
    await options.reserve();
    expect(reserveMock).toHaveBeenCalledWith({ recipient: 'owner@example.test' });
  });
});
