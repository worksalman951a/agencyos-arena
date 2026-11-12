import { describe, expect, it } from 'vitest';
import { emailTransport, isValidEmail, escapeHtml } from '@/lib/services/automation/email-service';

describe('Email Transport Adapter', () => {
  it('validates email addresses properly', () => {
    expect(isValidEmail('test@example.com')).toBe(true);
    expect(isValidEmail('admin.user+tag@domain.co.uk')).toBe(true);
    expect(isValidEmail('invalid-email')).toBe(false);
    expect(isValidEmail('@nodomain.com')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });

  it('escapes html entities safely', () => {
    const raw = '<script>alert("xss & hello")</script>';
    const escaped = escapeHtml(raw);
    expect(escaped).toBe('&lt;script&gt;alert(&quot;xss &amp; hello&quot;)&lt;/script&gt;');
  });

  it('returns unavailable status when SMTP environment variables are unset', async () => {
    const prevHost = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;

    const result = await emailTransport.send({
      to: 'client@example.com',
      subject: 'Invoice Reminder',
      text: 'Hello, your invoice is overdue.',
    });

    expect(result.status).toBe('unavailable');
    expect(result.reason).toContain('SMTP transport is not configured');

    if (prevHost) process.env.SMTP_HOST = prevHost;
  });

  it('rejects invalid recipient emails without attempting transport', async () => {
    const result = await emailTransport.send({
      to: 'not-an-email',
      subject: 'Hello',
      text: 'Test',
    });

    expect(result.status).toBe('failed');
    expect(result.reason).toContain('Invalid recipient');
  });
});
