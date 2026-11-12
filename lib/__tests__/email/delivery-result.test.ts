// @vitest-environment node

/**
 * How a delivery outcome is reported: to the API (`summarizeDelivery`), to the
 * audit trail (`deliveryAuditRecord`) and to the administrator
 * (`invitationEmailNotice`).
 *
 * One rule runs through all three: "sent" is only ever said about a message the
 * mail server accepted.
 */

import { describe, expect, it } from 'vitest';

import { invitationEmailNotice } from '@/lib/email/delivery-notice';
import {
  deliveryAuditRecord,
  summarizeDelivery,
  type EmailDeliveryResult,
  type EmailFailureReason,
} from '@/lib/email/types';

const MESSAGE_ID = '<11111111-2222-3333-4444-555555555555@example.test>';

const REASONS: EmailFailureReason[] = [
  'configuration',
  'invalid_message',
  'rate_limited',
  'connection',
  'timeout',
  'tls',
  'authentication',
  'rejected',
  'unknown',
];

const SENT: EmailDeliveryResult = { status: 'sent', messageId: MESSAGE_ID, attempts: 2 };
const DISABLED: EmailDeliveryResult = { status: 'disabled' };
const failed = (reason: EmailFailureReason, attempts = 1): EmailDeliveryResult => ({
  status: 'failed',
  reason,
  attempts,
});

describe('summarizeDelivery (what the API returns)', () => {
  it('reduces a sent message to its status', () => {
    expect(summarizeDelivery(SENT)).toEqual({ status: 'sent' });
  });

  it('keeps the reason of a failure and drops the attempt count', () => {
    for (const reason of REASONS) {
      expect(summarizeDelivery(failed(reason, 3))).toEqual({ status: 'failed', reason });
    }
  });

  it('reports disabled delivery as disabled', () => {
    expect(summarizeDelivery(DISABLED)).toEqual({ status: 'disabled' });
  });

  it('never turns a failure or disabled delivery into "sent"', () => {
    for (const result of [DISABLED, ...REASONS.map((reason) => failed(reason))]) {
      expect(summarizeDelivery(result).status).not.toBe('sent');
    }
  });
});

describe('deliveryAuditRecord (what the audit trail records)', () => {
  it('records a sent message with its Message-ID and attempt count', () => {
    expect(deliveryAuditRecord(SENT)).toEqual({
      event: 'email_sent',
      details: { messageId: MESSAGE_ID, attempts: 2 },
    });
  });

  it('records a failure with its reason and attempt count', () => {
    for (const reason of REASONS) {
      expect(deliveryAuditRecord(failed(reason, 2))).toEqual({
        event: 'email_failed',
        details: { reason, attempts: 2 },
      });
    }
  });

  it('records nothing when delivery is disabled: nothing was attempted', () => {
    expect(deliveryAuditRecord(DISABLED)).toBeNull();
  });

  it('uses "email_sent" for a sent message only', () => {
    for (const result of [DISABLED, ...REASONS.map((reason) => failed(reason))]) {
      expect(deliveryAuditRecord(result)?.event).not.toBe('email_sent');
    }
  });
});

describe('invitationEmailNotice (what the administrator is told)', () => {
  it('says the invitation was e-mailed only when the API said "sent"', () => {
    expect(invitationEmailNotice({ status: 'sent' }, 'client@example.test')).toEqual({
      tone: 'success',
      text: 'The invitation was e-mailed to client@example.test.',
    });
    expect(invitationEmailNotice({ status: 'sent' })).toEqual({
      tone: 'success',
      text: 'The invitation was e-mailed.',
    });
  });

  it('says it was not e-mailed, and to share the link, for every failure reason', () => {
    for (const reason of [...REASONS, 'a-reason-added-later', undefined]) {
      const notice = invitationEmailNotice({ status: 'failed', reason }, 'client@example.test');

      expect(notice?.tone, String(reason)).toBe('warning');
      expect(notice?.text).toMatch(/(was not|could not be) e-mailed/);
      expect(notice?.text).toMatch(/share the link below with the client yourself\.$/i);
      expect(notice?.text).not.toMatch(/was e-mailed/);
    }
  });

  it('explains the two failures an administrator can do something about', () => {
    expect(invitationEmailNotice({ status: 'failed', reason: 'rate_limited' })?.text).toContain(
      'the hourly sending limit has been reached'
    );
    expect(invitationEmailNotice({ status: 'failed', reason: 'rejected' })?.text).toContain(
      'Check the address'
    );
  });

  it('does not reveal how delivery is set up', () => {
    for (const reason of ['configuration', 'tls', 'authentication', 'connection', 'timeout']) {
      expect(invitationEmailNotice({ status: 'failed', reason })?.text).toBe(
        'The invitation could not be e-mailed. Share the link below with the client yourself.'
      );
    }
  });

  it('shows nothing when delivery is disabled, so the form looks as it always did', () => {
    expect(invitationEmailNotice({ status: 'disabled' })).toBeNull();
  });

  it.each([
    undefined,
    null,
    'sent',
    true,
    1,
    [],
    {},
    { status: 'SENT' },
    { status: 'delivered' },
    { status: 'ok' },
    { status: true },
    { sent: true },
    { status: ['sent'] },
  ])('never claims a delivery for the unexpected value %j', (value) => {
    expect(invitationEmailNotice(value, 'client@example.test')).toBeNull();
  });

  it('ignores a recipient that is not a string', () => {
    for (const recipient of [undefined, null, 42, {}, ['client@example.test'], '']) {
      expect(invitationEmailNotice({ status: 'sent' }, recipient)?.text).toBe(
        'The invitation was e-mailed.'
      );
    }
  });
});
