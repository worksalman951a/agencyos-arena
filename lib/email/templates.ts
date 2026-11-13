/**
 * Transactional e-mail templates (pure module: no I/O, no configuration).
 *
 * One layout - a heading, a few paragraphs, a single action link and some small
 * print - rendered as both plain text and HTML. Each message is a short function
 * that fills the layout in, so a further message (a password reset, a team
 * invitation) is one more such function rather than a second layout.
 *
 * Untrusted text:
 *  - `renderActionEmail` treats every string it is given as plain text. Each one
 *    is flattened to a single line and HTML-escaped at the point it is written
 *    out, so a template cannot forget to do it.
 *  - The action link must be an absolute http(s) URL; anything else is refused.
 *
 * Accessibility: the HTML has a language, a title and one real heading; the link
 * text says what it does; the full URL is also shown as text; nothing depends on
 * an image or on colour alone; colours meet WCAG AA contrast; and a plain-text
 * alternative is always produced.
 *
 * What a message discloses: the organization's display name (which the public
 * invitation page already shows), the recipient's own first name when known, the
 * link and its expiry. No internal ids, role names, permissions or staff
 * identities.
 */

import { singleLine } from '@/lib/email/address';
import type { EmailContent } from '@/lib/email/types';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const EXPIRY_FORMAT = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'UTC',
});

/** A point in time as unambiguous prose, e.g. `19 November 2026 at 16:40 UTC`. */
export function formatExpiry(expiresAt: Date): string {
  return `${EXPIRY_FORMAT.format(expiresAt)} UTC`;
}

export interface ActionEmail {
  subject: string;
  heading: string;
  /** Shown before the action. Plain text. */
  paragraphs: string[];
  /** The one thing the recipient is asked to do. */
  action: { label: string; url: string };
  /** Small print after the action: expiry, single use, what to do if unexpected. */
  notes: string[];
}

function httpUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('The action link must be an http(s) URL');
  }
  return url.href;
}

/** Render the shared layout. Throws if the action link is not an http(s) URL. */
export function renderActionEmail(input: ActionEmail): EmailContent {
  const subject = singleLine(input.subject, 200);
  const heading = singleLine(input.heading, 200);
  const paragraphs = input.paragraphs.map((paragraph) => singleLine(paragraph, 600));
  const notes = input.notes.map((note) => singleLine(note, 600));
  const label = singleLine(input.action.label, 80);
  const url = httpUrl(input.action.url);

  const text = [
    heading,
    '',
    ...paragraphs.flatMap((paragraph) => [paragraph, '']),
    `${label}:`,
    url,
    '',
    ...notes,
    '',
  ].join('\n');

  const paragraph = 'margin:0 0 16px;';
  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(subject)}</title>`,
    '</head>',
    '<body style="margin:0;padding:24px;background-color:#f4f4f5;color:#18181b;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;">',
    '<div style="max-width:560px;margin:0 auto;padding:32px;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:8px;">',
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;">${escapeHtml(heading)}</h1>`,
    ...paragraphs.map((line) => `<p style="${paragraph}">${escapeHtml(line)}</p>`),
    `<p style="margin:24px 0;"><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;background-color:#047857;color:#ffffff;font-weight:bold;text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a></p>`,
    `<p style="${paragraph}">If the button does not work, copy and paste this link into your browser:<br><a href="${escapeHtml(url)}" style="color:#047857;word-break:break-all;">${escapeHtml(url)}</a></p>`,
    ...notes.map(
      (line) => `<p style="margin:0 0 8px;font-size:14px;color:#52525b;">${escapeHtml(line)}</p>`
    ),
    '</div>',
    '</body>',
    '</html>',
    '',
  ].join('\n');

  return { subject, text, html };
}

export interface ClientInvitationEmailInput {
  /** Display name of the inviting organization. Untrusted: a tenant chose it. */
  organizationName: string;
  /** The recipient's first name, when known. Untrusted: a tenant typed it. */
  recipientName?: string | null;
  /** Absolute link to the acceptance page. */
  acceptUrl: string;
  expiresAt: Date;
}

/** Invitation of a client contact into an organization's client portal. */
export function clientInvitationEmail(input: ClientInvitationEmailInput): EmailContent {
  const organization = singleLine(input.organizationName, 120);
  const name = singleLine(input.recipientName, 80);
  const portal = organization ? `the ${organization} client portal` : 'a client portal';

  return renderActionEmail({
    subject: `Invitation to ${portal}`,
    heading: `You have been invited to ${portal}`,
    paragraphs: [
      name ? `Hello ${name},` : 'Hello,',
      organization
        ? `${organization} has invited you to their client portal, where you can follow the work they share with you.`
        : 'You have been invited to a client portal, where you can follow the work shared with you.',
      'To accept, open the link below and sign in - or create a password - with the e-mail address this message was sent to. If that account has not verified the address, request and complete its separate ownership-verification email first.',
    ],
    action: { label: 'Accept invitation', url: input.acceptUrl },
    notes: [
      `This invitation expires on ${formatExpiry(input.expiresAt)} and can be used once.`,
      'If you were not expecting this invitation, you can ignore this e-mail.',
    ],
  });
}

export interface TeamInvitationEmailInput {
  organizationName: string;
  acceptUrl: string;
  expiresAt: Date;
}

/** Invitation to join an organization's internal AgencyOS workspace. */
export function teamInvitationEmail(input: TeamInvitationEmailInput): EmailContent {
  const organization = singleLine(input.organizationName, 120);
  const workspace = organization ? `${organization} AgencyOS workspace` : 'an AgencyOS workspace';
  return renderActionEmail({
    subject: `Invitation to ${workspace}`,
    heading: `You have been invited to ${workspace}`,
    paragraphs: [
      'Hello,',
      `You have been invited to join ${workspace} as a team member.`,
      'To accept, sign in or create an account using the e-mail address this message was sent to. Verify ownership of the address if prompted before accepting.',
    ],
    action: { label: 'Accept team invitation', url: input.acceptUrl },
    notes: [
      `This invitation expires on ${formatExpiry(input.expiresAt)} and can be used once.`,
      'If you were not expecting this invitation, you can ignore this e-mail.',
    ],
  });
}

export interface EmailOwnershipVerificationEmailInput {
  /** Absolute verification page URL; the bearer token is in its fragment. */
  verificationUrl: string;
  expiresAt: Date;
}

/** Verify mailbox ownership without changing sign-in policy or account status. */
export function emailOwnershipVerificationEmail(
  input: EmailOwnershipVerificationEmailInput
): EmailContent {
  return renderActionEmail({
    subject: 'Verify your AgencyOS email address',
    heading: 'Verify your email address',
    paragraphs: [
      'Hello,',
      'We received a request to verify ownership of the email address used for an AgencyOS account.',
      'Open the link and confirm on the page to complete verification.',
    ],
    action: { label: 'Review verification request', url: input.verificationUrl },
    notes: [
      `This link expires on ${formatExpiry(input.expiresAt)} and can be used once.`,
      'If you did not request this, ignore the message. Your account access will not change.',
    ],
  });
}

export interface PasswordResetEmailInput {
  /** Absolute link to the reset page. Contains the single-use token. */
  resetUrl: string;
  expiresAt: Date;
}

/**
 * Password-reset message.
 *
 * Deliberately generic about the account: the same message goes to an internal
 * team member and a client-portal identity, and it names no organization,
 * role or internal id. The only facts are that somebody asked to reset "the
 * AgencyOS account for this address", the one link, and its expiry - which is
 * what the recipient needs and nothing that would help somebody who guessed
 * the address learn about the account.
 */
export function passwordResetEmail(input: PasswordResetEmailInput): EmailContent {
  return renderActionEmail({
    subject: 'Reset your AgencyOS password',
    heading: 'Reset your password',
    paragraphs: [
      'Hello,',
      'We received a request to reset the password for the AgencyOS account that uses this e-mail address.',
      'Choose a new password using the link below. The link can be used once.',
    ],
    action: { label: 'Reset password', url: input.resetUrl },
    notes: [
      `This link expires on ${formatExpiry(input.expiresAt)}.`,
      'If you did not request a password reset, you can ignore this e-mail - your password will not change.',
      'AgencyOS will never ask you for your password by e-mail.',
    ],
  });
}
