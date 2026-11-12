// @vitest-environment jsdom

/**
 * Transactional e-mail templates (`lib/email/templates.ts`).
 *
 * The HTML alternative is parsed with a real DOM (jsdom) rather than matched
 * with regular expressions, so "no markup was injected" is asserted the way a
 * mail client would see it.
 */

import { describe, expect, it } from 'vitest';

import { isSingleLine } from '@/lib/email/address';
import {
  clientInvitationEmail,
  escapeHtml,
  formatExpiry,
  renderActionEmail,
} from '@/lib/email/templates';

const ACCEPT_URL = 'https://app.example.test/portal/invite/tok_AbC-123_xyz';
const EXPIRES_AT = new Date('2026-11-19T16:40:00.000Z');

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function invitation(overrides: Partial<Parameters<typeof clientInvitationEmail>[0]> = {}) {
  return clientInvitationEmail({
    organizationName: 'Acme Agency',
    recipientName: 'Jane',
    acceptUrl: ACCEPT_URL,
    expiresAt: EXPIRES_AT,
    ...overrides,
  });
}

/** WCAG 2.x relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

describe('escapeHtml', () => {
  it('escapes the five characters that matter in text and attribute context', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;'
    );
  });

  it('escapes an ampersand first, so existing entities are not double-decoded', () => {
    expect(escapeHtml('&lt;script&gt;')).toBe('&amp;lt;script&amp;gt;');
  });
});

describe('formatExpiry', () => {
  it('states the date, the time and the time zone', () => {
    expect(formatExpiry(EXPIRES_AT)).toBe('19 November 2026 at 16:40 UTC');
  });

  it('is rendered in UTC regardless of the server time zone', () => {
    // 23:30 UTC is already the next day in most of Asia; the text must not move.
    expect(formatExpiry(new Date('2026-12-31T23:30:00.000Z'))).toBe(
      '31 December 2026 at 23:30 UTC'
    );
  });
});

describe('clientInvitationEmail', () => {
  it('names the organization, greets the contact and states the expiry', () => {
    const email = invitation();

    expect(email.subject).toBe('Invitation to the Acme Agency client portal');
    expect(email.text).toContain('Hello Jane,');
    expect(email.text).toContain('Acme Agency has invited you to their client portal');
    expect(email.text).toContain(
      'This invitation expires on 19 November 2026 at 16:40 UTC and can be used once.'
    );
    expect(email.text).toContain('If you were not expecting this invitation');
  });

  it('carries the acceptance link, unchanged, in both alternatives', () => {
    const email = invitation();

    expect(email.text.split('\n')).toContain(ACCEPT_URL);

    const links = Array.from(parse(email.html).querySelectorAll('a'));
    expect(links.length).toBe(2);
    for (const link of links) expect(link.getAttribute('href')).toBe(ACCEPT_URL);
  });

  it('contains no link other than the acceptance link', () => {
    const email = invitation();
    const document = parse(email.html);

    const urls = email.text.match(/https?:\/\/\S+/g) ?? [];
    expect(urls).toEqual([ACCEPT_URL]);
    expect(document.querySelectorAll('img, script, iframe, form, link, style, object').length).toBe(
      0
    );
    for (const element of Array.from(document.querySelectorAll('[href], [src]'))) {
      expect(element.getAttribute('href') ?? element.getAttribute('src')).toBe(ACCEPT_URL);
    }
  });

  it('greets without a name when the contact has none', () => {
    for (const recipientName of [null, undefined, '', '   ']) {
      const email = invitation({ recipientName });
      expect(email.text).toContain('Hello,');
      expect(email.text).not.toContain('Hello ,');
    }
  });

  it('still reads correctly when the organization has no name', () => {
    const email = invitation({ organizationName: '  ' });
    expect(email.subject).toBe('Invitation to a client portal');
    expect(email.text).toContain('You have been invited to a client portal');
    expect(email.text).not.toContain('the  client portal');
  });

  describe('untrusted text', () => {
    const HOSTILE = `<script>alert(1)</script><img src=x onerror=alert(2)>"'&`;

    it('renders markup in the organization name as text, not as elements', () => {
      const email = invitation({ organizationName: HOSTILE });
      const document = parse(email.html);

      expect(document.querySelectorAll('script, img').length).toBe(0);
      expect(document.querySelector('h1')?.textContent).toContain(HOSTILE);
      expect(email.html).not.toContain('<script>');
      expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    it('renders markup in the recipient name as text, not as elements', () => {
      const email = invitation({ recipientName: '<b onmouseover=alert(1)>Jane</b>' });
      const document = parse(email.html);

      expect(document.querySelectorAll('b').length).toBe(0);
      expect(document.body.textContent).toContain('Hello <b onmouseover=alert(1)>Jane</b>,');
    });

    it('cannot close the <title> element from the subject', () => {
      const email = invitation({ organizationName: '</title><script>alert(1)</script>' });
      const document = parse(email.html);

      expect(document.querySelectorAll('script').length).toBe(0);
      expect(document.title).toContain('</title><script>alert(1)</script>');
    });

    it('cannot add an attribute or a second link through a name', () => {
      const email = invitation({
        organizationName: '" onclick="alert(1)" x="',
        recipientName: `<a href="https://evil.example/">click</a>`,
      });
      const document = parse(email.html);

      const links = Array.from(document.querySelectorAll('a'));
      expect(links.map((link) => link.getAttribute('href'))).toEqual([ACCEPT_URL, ACCEPT_URL]);
      for (const element of Array.from(document.querySelectorAll('*'))) {
        expect(element.getAttribute('onclick')).toBeNull();
      }
    });

    it('keeps the subject on one line, so a name cannot add a header', () => {
      const email = invitation({
        organizationName: 'Acme\r\nBcc: attacker@evil.example\r\n\r\nInjected body',
      });

      expect(isSingleLine(email.subject)).toBe(true);
      expect(email.subject).toBe(
        'Invitation to the Acme Bcc: attacker@evil.example Injected body client portal'
      );
    });

    it('keeps a name on its own line in the plain-text alternative', () => {
      const baseline = invitation().text.split('\n').length;
      const email = invitation({
        organizationName: 'Acme\n\nhttps://evil.example/login\n',
        recipientName: 'Jane\nUrgent: act now',
      });
      expect(email.text.split('\n').length).toBe(baseline);
    });

    it('removes bidirectional overrides that could disguise text', () => {
      const email = invitation({ organizationName: 'Acme \u202eevil' });
      expect(email.subject).not.toMatch(/[\u202a-\u202e\u2066-\u2069]/);
      expect(email.html).not.toMatch(/[\u202a-\u202e\u2066-\u2069]/);
      expect(email.text).not.toMatch(/[\u202a-\u202e\u2066-\u2069]/);
    });

    it('caps the length of the names it prints', () => {
      const email = invitation({
        organizationName: 'A'.repeat(5000),
        recipientName: 'J'.repeat(5000),
      });

      expect(email.subject.length).toBeLessThanOrEqual(200);
      expect(email.text).toContain(`Hello ${'J'.repeat(80)},`);
      expect(email.text).not.toContain('J'.repeat(81));
      expect(email.text).not.toContain('A'.repeat(121));
    });
  });

  describe('what the message discloses', () => {
    it('prints nothing but the values it was given', () => {
      // The template takes four values and has no access to anything else:
      // no ids, no role, no capabilities, no inviter, no other tenant's data.
      const email = invitation({
        organizationName: 'ORGNAME',
        recipientName: 'FIRSTNAME',
        acceptUrl: 'https://app.example.test/portal/invite/TOKEN',
      });

      const variable = (email.subject + email.text)
        .replace(/ORGNAME|FIRSTNAME|https:\/\/app\.example\.test\/portal\/invite\/TOKEN/g, '')
        .replace(/19 November 2026 at 16:40 UTC/g, '');
      expect(variable).not.toMatch(/[A-Z]{3,}/);
      expect(variable).not.toMatch(/\d/);
    });

    it('does not mention the role, capabilities or an internal user', () => {
      const email = invitation();
      for (const body of [email.text, email.html]) {
        expect(body).not.toMatch(/client_(viewer|reviewer|approver)|capabilit|permission|role/i);
      }
    });
  });

  describe('accessibility', () => {
    it('declares a language and a title', () => {
      const email = invitation();
      const document = parse(email.html);

      expect(document.documentElement.getAttribute('lang')).toBe('en');
      expect(document.title).toBe(email.subject);
      expect(email.html.startsWith('<!doctype html>')).toBe(true);
    });

    it('has exactly one heading, and it is a real <h1>', () => {
      const document = parse(invitation().html);
      const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');

      expect(headings.length).toBe(1);
      expect(headings[0].tagName).toBe('H1');
      expect(headings[0].textContent).toBe(
        'You have been invited to the Acme Agency client portal'
      );
    });

    it('gives the action link text that says what it does', () => {
      const [action] = Array.from(parse(invitation().html).querySelectorAll('a'));
      expect(action.textContent).toBe('Accept invitation');
    });

    it('also shows the full link as text, for clients that strip buttons', () => {
      const links = Array.from(parse(invitation().html).querySelectorAll('a'));
      expect(links[1].textContent).toBe(ACCEPT_URL);
    });

    it('does not rely on images', () => {
      expect(parse(invitation().html).querySelectorAll('img, svg, picture').length).toBe(0);
    });

    it('always provides a plain-text alternative with the same content', () => {
      const email = invitation();
      const blocks = Array.from(parse(email.html).querySelectorAll('h1, p'))
        .map((element) => element.textContent ?? '')
        // The one HTML-only sentence: it introduces the link the text part prints anyway.
        .filter((block) => !block.startsWith('If the button does not work'));

      expect(blocks.length).toBe(7);
      for (const block of blocks) expect(email.text).toContain(block);
      expect(email.text).toContain(ACCEPT_URL);
      expect(email.text).not.toMatch(/<[a-z!/]/i);
    });

    it('uses colour pairs that meet WCAG AA contrast (4.5:1)', () => {
      const html = invitation().html;
      const colours = new Set(html.match(/(?<![-\w])color:#[0-9a-f]{6}/g));
      expect(colours.size).toBeGreaterThan(0);

      // Text colours sit on the white card; the button is white on its fill.
      for (const declaration of colours) {
        const colour = declaration.slice('color:'.length);
        const background = colour === '#ffffff' ? '#047857' : '#ffffff';
        expect(contrast(colour, background), `${colour} on ${background}`).toBeGreaterThanOrEqual(
          4.5
        );
      }
      expect(html).toContain('background-color:#047857;color:#ffffff');
    });
  });
});

describe('renderActionEmail', () => {
  const base = {
    subject: 'Subject',
    heading: 'Heading',
    paragraphs: ['One.'],
    action: { label: 'Open', url: ACCEPT_URL },
    notes: ['Note.'],
  };

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'mailto:attacker@evil.example',
    '/portal/invite/token',
    '//evil.example/portal/invite/token',
    'not a url',
    '',
  ])('refuses the action link %j', (url) => {
    expect(() => renderActionEmail({ ...base, action: { label: 'Open', url } })).toThrow();
  });

  it('escapes a link that contains characters special to HTML', () => {
    const url = 'https://app.example.test/path?a=1&b=<2>"';
    const email = renderActionEmail({ ...base, action: { label: 'Open', url } });
    const [link] = Array.from(parse(email.html).querySelectorAll('a'));

    expect(link.getAttribute('href')).toBe(new URL(url).href);
    expect(parse(email.html).querySelectorAll('a').length).toBe(2);
  });

  it('escapes every caller-supplied string', () => {
    const payload = '<i>x</i>';
    const email = renderActionEmail({
      subject: payload,
      heading: payload,
      paragraphs: [payload],
      action: { label: payload, url: ACCEPT_URL },
      notes: [payload],
    });
    const document = parse(email.html);

    expect(document.querySelectorAll('i').length).toBe(0);
    expect(email.html.match(/&lt;i&gt;x&lt;\/i&gt;/g)?.length).toBe(5);
  });
});
