/**
 * Audit-log pagination links.
 *
 * The page is a Server Component and the views are Client Components, so the
 * pagination URL has to be rebuilt from serialisable strings. A `hrefBuilder`
 * closure used to be passed across that boundary, which React rejects at
 * render time:
 *
 *   Error: Functions cannot be passed directly to Client Components
 *   {… hrefBuilder: function hrefBuilder}  digest: '2288029065'
 *   GET /admin/audit-logs 500
 *
 * These tests pin the replacement: the pure builder below, the absence of a
 * function prop on either view, and the page handing over nothing but data.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildAuditLogPageHref } from '@/lib/admin/audit-log-links';

const ROOT = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

describe('buildAuditLogPageHref', () => {
  it('returns the bare list URL for the unfiltered first page', () => {
    expect(buildAuditLogPageHref(1)).toBe('/admin/audit-logs');
    expect(buildAuditLogPageHref(1, {})).toBe('/admin/audit-logs');
  });

  it('adds the page number for later pages', () => {
    expect(buildAuditLogPageHref(2)).toBe('/admin/audit-logs?page=2');
    expect(buildAuditLogPageHref(7)).toBe('/admin/audit-logs?page=7');
  });

  it('keeps the active action filter on every page', () => {
    // Page 1 with a filter must not lose it.
    expect(buildAuditLogPageHref(1, { action: 'notification.' })).toBe(
      '/admin/audit-logs?action=notification.'
    );
    // Later pages keep the filter and add the page.
    expect(buildAuditLogPageHref(3, { action: 'notification.' })).toBe(
      '/admin/audit-logs?action=notification.&page=3'
    );
  });

  it('keeps the active entity-type filter', () => {
    expect(buildAuditLogPageHref(2, { entityType: 'invoice' })).toBe(
      '/admin/audit-logs?entityType=invoice&page=2'
    );
  });

  it('keeps both filters together and encodes them', () => {
    expect(buildAuditLogPageHref(2, { action: 'user.role', entityType: 'user' })).toBe(
      '/admin/audit-logs?action=user.role&entityType=user&page=2'
    );
    // Values are query-encoded rather than interpolated raw.
    expect(buildAuditLogPageHref(1, { action: 'a b&c=d' })).toBe(
      '/admin/audit-logs?action=a+b%26c%3Dd'
    );
  });

  it('ignores an invalid page number instead of emitting it', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(buildAuditLogPageHref(bad, { action: 'x' })).toBe('/admin/audit-logs?action=x');
    }
  });

  it('is a pure module with no server-only imports', () => {
    const source = read('lib/admin/audit-log-links.ts');
    expect(source).not.toMatch(/from ['"]@\/lib\/(db|auth-server|permissions)/);
    expect(source).not.toContain('prisma');
    expect(source).not.toContain("'use server'");
    expect(source).not.toContain("'use client'");
  });
});

describe('audit-log page crosses the Server/Client boundary with data only', () => {
  const page = read('app/admin/audit-logs/page.tsx');
  const client = read('app/admin/audit-logs/audit-logs-client.tsx');
  const bento = read('components/admin/bento-audit-logs-view.tsx');

  it('the page is a Server Component that never passes a function prop', () => {
    expect(page).not.toContain("'use client'");
    // The original bug: a local closure handed to the Client Component.
    // Checked as code, not prose - the explanatory comment names the old prop.
    expect(page).not.toMatch(/^\s*hrefBuilder[=:\s]/m);
    expect(page).not.toContain('hrefBuilder={');
    expect(page).not.toMatch(/href=\{\s*\(/);
    // Pagination is derived inside the client from these strings instead.
    expect(page).toContain('currentAction={action}');
    expect(page).toContain('currentEntityType={entityType}');
  });

  it('neither view accepts a function prop for pagination', () => {
    expect(client).not.toContain('hrefBuilder');
    expect(bento).not.toContain('hrefBuilder');
    expect(client).toContain('buildAuditLogPageHref');
    expect(bento).toContain('buildAuditLogPageHref');
  });

  it('keeps loading, permissions and organization scoping on the server', () => {
    expect(page).toContain('listAuditLogs');
    expect(page).toContain('loadPageData');
    // Authorization stays in the service, not in the client component.
    expect(client).not.toContain('listAuditLogs(');
    expect(bento).not.toContain('prisma');
  });
});
