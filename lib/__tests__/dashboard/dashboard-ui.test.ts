/**
 * Dashboard and branding wiring (source-level checks).
 *
 * These complement the metric maths tests: they assert the page is actually
 * wired to the data layer, the four metrics are distinct, the quick action
 * navigates instead of calling a missing handler, and branding reaches the shell.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('dashboard page', () => {
  const src = read('app/dashboard/page.tsx');
  const clientView = read('app/dashboard/dashboard-client-view.tsx');

  it('renders four distinct metrics from the service layer', () => {
    for (const title of [
      'Total Invoiced',
      'Total Collected',
      'Outstanding Receivables',
      'Overdue Amount',
    ]) {
      expect(clientView, title).toContain(title);
    }

    expect(src).toContain('getDashboardMetrics');
    expect(src).toContain('getOpenOpportunities');
    expect(src).toContain('getRecentActivity');
  });

  it('no longer ships the hardcoded placeholder figures', () => {
    // The literal only survives in the explanatory doc comment.
    const code = clientView
      .split('\n')
      .filter((line) => !line.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toContain('$0.00');
    // Opportunity figures are gated on a real (permission-checked) result.
    expect(clientView).toContain('opportunities.ok ?');
  });

  it('navigates to the real new-project workflow, permission-aware', () => {
    // A <button> with no handler was the bug: the action did nothing.
    expect(clientView).toContain('href="/projects/new"');
    expect(src).toContain("permissions.has('project.create')");
    expect(clientView).not.toMatch(/<button[^>]*>\s*New Project/);
  });

  it('shows currencies separately and never converts', () => {
    expect(clientView).toContain('otherCurrencies');
    expect(clientView).toContain('no exchange-rate conversion');
  });

  it('explains permission limits instead of showing misleading zeros', () => {
    expect(clientView).toContain('metrics.ok ?');
    expect(clientView).toContain('does not include permission to view');
    expect(clientView).toContain('do not have permission to view the activity log');
  });
});

describe('white-label branding wiring', () => {
  const shell = read('components/layout/app-shell.tsx');
  const sidebar = read('components/layout/sidebar.tsx');
  const moduleShell = read('components/server/module-shell.tsx');

  it('resolves branding on the server and passes it to the shell', () => {
    expect(moduleShell).toContain('getBranding');
    expect(moduleShell).toContain('branding={branding}');
  });

  it('injects the brand theme tokens and publishes the branding context', () => {
    expect(shell).toContain('branding.themeCss');
    expect(shell).toContain('id="org-brand-theme"');
    expect(shell).toContain('BrandingProvider');
    expect(shell).toContain('brandName');
  });

  it('renders the brand mark in the sidebar with a fallback', () => {
    expect(sidebar).toContain('BrandMark');
    expect(sidebar).toContain("brandName = 'AgencyOS'");
    expect(sidebar).toContain('logoUrl');
  });

  it('brands documents, including the invoice PDF', () => {
    for (const page of [
      'app/finance/invoices/[id]/page.tsx',
      'app/sales/proposals/[id]/page.tsx',
      'app/sales/quotations/[id]/page.tsx',
      'app/finance/estimates/[id]/page.tsx',
      'app/documents/contracts/[id]/page.tsx',
    ]) {
      expect(read(page), page).toContain('DocumentBrandHeader');
    }

    const pdf = read('components/invoices/print-invoice.tsx');
    expect(pdf).toContain('/api/v1/settings/branding');
    expect(pdf).toContain('loadLogo');
    // The export must survive a missing logo or a blocked cross-origin image.
    expect(pdf).toContain('catch');
  });
});

describe('settings API contract', () => {
  it('validates with the shared schema and reports per-field errors', () => {
    const route = read('app/api/v1/settings/organization/route.ts');
    expect(route).toContain('fieldErrors');
    expect(route).toContain('status === 400');
    expect(route).toContain('Could not load or save settings');
    expect(route).not.toContain("'Not found',\n      statusCode");

    const service = read('lib/services/settings/organization-service.ts');
    expect(service).toContain('organizationSettingsPatchSchema');
    expect(service).toContain('settingsPatchFromParsed');
    expect(service).toContain('previewNextDocumentNumber');
    expect(service).toContain('isOrganizationAdmin');
  });

  it('keeps user profile writes validated and self-scoped', () => {
    const route = read('app/api/v1/settings/user/route.ts');
    expect(route).toContain('userProfileUpdateSchema');
    expect(route).toContain('fieldErrors');

    const service = read('lib/services/settings/user-service.ts');
    expect(service).toContain('userId');
    // Email / role / status are never written from the profile endpoint.
    expect(service).not.toContain('email: input');
    expect(service).not.toContain('role: input');
  });
});
