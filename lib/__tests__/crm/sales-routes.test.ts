/**
 * Unit tests for Sales route integration and builder entry/edit flows.
 *
 * Verifies that:
 * - New Proposal / New Quotation routes redirect to the Phase 2.2 builder
 * - Edit Proposal / Edit Quotation routes redirect to the builder with document ID
 * - Sidebar navigation includes Quotations alongside Proposals
 * - Builder pages accept document ID for edit mode
 * - Existing Phase 2.1 list/detail pages remain accessible
 *
 * Prisma is mocked so these tests run without a live database.
 */

vi.mock('@/lib/db', () => ({
  prisma: {
    $connect: vi.fn(),
    $disconnect: vi.fn(),
  },
}));

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import { NAV_SECTIONS } from '@/lib/navigation';

const ROOT = process.cwd();

function readRel(p: string): string {
  return readFileSync(join(ROOT, p), 'utf-8');
}

describe('Sales route integration (redirects to Phase 2.2 builder)', () => {
  it('New Proposal page redirects to /sales/proposals/builder', () => {
    const src = readRel('app/sales/proposals/new/page.tsx');
    expect(src).toContain("redirect('/sales/proposals/builder')");
    expect(src).not.toContain('CreateProposalPage');
    expect(src).not.toContain('Card');
  });

  it('New Quotation page redirects to /sales/quotations/builder', () => {
    const src = readRel('app/sales/quotations/new/page.tsx');
    expect(src).toContain("redirect('/sales/quotations/builder')");
    expect(src).not.toContain('CreateQuotationForm');
    expect(src).not.toContain('Card');
  });

  it('Proposal Edit page awaits params and redirects to builder with document ID', () => {
    const src = readRel('app/sales/proposals/[id]/edit/page.tsx');
    // Next.js 16: params is a Promise, so the id must be awaited before use.
    expect(src).toContain('const { id } = await params;');
    expect(src).toContain('redirect(`/sales/proposals/builder/${id}`)');
    expect(src).toContain('params: Promise<{ id: string }>');
    // Regression guard: synchronous params access produced ".../undefined".
    expect(src).not.toContain('params.id');
    expect(src).not.toContain('EditProposalForm');
  });

  it('Quotation Edit page awaits params and redirects to builder with document ID', () => {
    const src = readRel('app/sales/quotations/[id]/edit/page.tsx');
    expect(src).toContain('const { id } = await params;');
    expect(src).toContain('redirect(`/sales/quotations/builder/${id}`)');
    expect(src).toContain('params: Promise<{ id: string }>');
    expect(src).not.toContain('params.id');
    expect(src).not.toContain('EditQuotationForm');
  });
});

describe('Sales layout uses the shared application shell', () => {
  it('SalesLayout renders the one shared ModuleShell (not a standalone header)', () => {
    const src = readRel('app/sales/layout.tsx');
    expect(src).toContain('@/components/server/module-shell');
    expect(src).toContain('<ModuleShell>');
    expect(src).not.toContain('AgencyOS Sales');
    // The shell must not be re-implemented per module.
    expect(src).not.toContain('@/components/layout/sidebar');
    expect(src).not.toContain('DashboardClientLayout');
  });

  it('SalesLayout preserves auth validation (session check lives in the shell)', () => {
    const layout = readRel('app/sales/layout.tsx');
    expect(layout).toContain('dynamic = ');

    const shell = readRel('components/server/module-shell.tsx');
    expect(shell).toContain('getSessionUser');
    expect(shell).toContain("redirect('/login')");
  });
});

describe('Sidebar navigation includes Proposals and Quotations', () => {
  const navItems = NAV_SECTIONS.flatMap((section) => section.items);

  it('Sidebar has Proposals nav item pointing to /sales/proposals', () => {
    expect(navItems).toContainEqual({
      name: 'Proposals',
      href: '/sales/proposals',
      icon: 'proposals',
      permission: 'proposal.read',
    });
  });

  it('Sidebar has Quotations nav item pointing to /sales/quotations', () => {
    expect(navItems).toContainEqual({
      name: 'Quotations',
      href: '/sales/quotations',
      icon: 'quotations',
      permission: 'quotation.read',
    });
  });

  it('All CRM and Sales modules are accessible from sidebar', () => {
    const hrefs = navItems.map((item) => item.href);
    const expected = [
      '/dashboard',
      '/crm/contacts',
      '/crm/accounts',
      '/crm/pipelines',
      '/crm/leads',
      '/crm/opportunities',
      '/sales/proposals',
      '/sales/quotations',
    ];
    for (const href of expected) {
      expect(hrefs).toContain(href);
    }
  });
});

describe('Builder pages create mode vs edit mode', () => {
  // /sales/proposals/builder and /sales/quotations/builder have no dynamic
  // segment, so there is no route id to read. Editing is served by
  // builder/[id]/page.tsx. Reading params synchronously here was dead code
  // that Next.js 16 evaluated against a Promise.
  it('Proposal builder create page renders BuilderApp without reading a route id', () => {
    const src = readRel('app/sales/proposals/builder/page.tsx');
    expect(src).not.toContain('params.id');
    expect(src).toContain('isEdit');
    expect(src).toContain('ProposalBuilderApp');
  });

  it('Quotation builder create page renders BuilderApp without reading a route id', () => {
    const src = readRel('app/sales/quotations/builder/page.tsx');
    expect(src).not.toContain('params.id');
    expect(src).toContain('isEdit');
    expect(src).toContain('QuotationBuilderApp');
  });

  it('Proposal builder edit route awaits params and passes the id to BuilderApp', () => {
    const src = readRel('app/sales/proposals/builder/[id]/page.tsx');
    expect(src).toContain('const { id } = await params;');
    expect(src).toContain('proposalId={id}');
    expect(src).toContain('isEdit={true}');
  });

  it('Quotation builder edit route awaits params and passes the id to BuilderApp', () => {
    const src = readRel('app/sales/quotations/builder/[id]/page.tsx');
    expect(src).toContain('const { id } = await params;');
    expect(src).toContain('quotationId={id}');
    expect(src).toContain('isEdit={true}');
  });
});

describe('Builder page data loading uses correct service response keys', () => {
  it('Proposal builder accesses contacts (not proposals) from listContacts', () => {
    const src = readRel('app/sales/proposals/builder/page.tsx');
    expect(src).toContain('(contactsResult as { contacts: unknown[] }).contacts');
    expect(src).not.toContain('(contactsResult as { proposals: unknown[] }).proposals');
  });

  it('Proposal builder accesses opportunities (not proposals) from listOpportunities', () => {
    const src = readRel('app/sales/proposals/builder/page.tsx');
    expect(src).toContain('(opportunitiesResult as { opportunities: unknown[] }).opportunities');
    expect(src).not.toContain('(opportunitiesResult as { proposals: unknown[] }).proposals');
  });

  it('Quotation builder accesses contacts (not proposals) from listContacts', () => {
    const src = readRel('app/sales/quotations/builder/page.tsx');
    expect(src).toContain('(contactsResult as { contacts: unknown[] }).contacts');
    expect(src).not.toContain('(contactsResult as { proposals: unknown[] }).proposals');
  });

  it('Quotation builder accesses opportunities (not proposals) from listOpportunities', () => {
    const src = readRel('app/sales/quotations/builder/page.tsx');
    expect(src).toContain('(opportunitiesResult as { opportunities: unknown[] }).opportunities');
    expect(src).not.toContain('(opportunitiesResult as { proposals: unknown[] }).proposals');
  });

  it('Catch blocks use correct response keys for contacts and opportunities', () => {
    const proposalSrc = readRel('app/sales/proposals/builder/page.tsx');
    const quotationSrc = readRel('app/sales/quotations/builder/page.tsx');

    for (const src of [proposalSrc, quotationSrc]) {
      expect(src).toContain('contacts: []');
      expect(src).toContain('opportunities: []');
      expect(src).not.toContain('proposals: []');
    }
  });
});

describe('Phase 2.1 list/detail pages remain accessible', () => {
  it('Proposals list page exists and links to builder', () => {
    const src = readRel('app/sales/proposals/page.tsx');
    expect(src).toContain('New Proposal');
    expect(src).toContain('/sales/proposals/new');
    expect(src).toContain('listProposals');
  });

  it('Quotations list page exists and links to builder', () => {
    const src = readRel('app/sales/quotations/page.tsx');
    expect(src).toContain('New Quotation');
    expect(src).toContain('/sales/quotations/new');
    expect(src).toContain('listQuotations');
  });

  it('Proposal detail page exists', () => {
    const src = readRel('app/sales/proposals/[id]/page.tsx');
    expect(src).toContain('getProposal');
    expect(src).toContain('proposal.title');
  });

  it('Quotation detail page exists', () => {
    const src = readRel('app/sales/quotations/[id]/page.tsx');
    expect(src).toContain('getQuotation');
    expect(src).toContain('quotation.title');
  });
});

describe('Dynamic builder edit routes (Next.js 16 async params)', () => {
  it('Proposal builder edit route exists at builder/[id]/page.tsx', () => {
    const src = readRel('app/sales/proposals/builder/[id]/page.tsx');
    expect(src).toContain('ProposalBuilderApp');
    expect(src).toContain('isEdit={true}');
    expect(src).toContain('proposalId={id}');
    expect(src).toContain('existingProposal={existingProposalData}');
    expect(src).toContain("redirect('/sales/proposals')");
  });

  it('Quotation builder edit route exists at builder/[id]/page.tsx', () => {
    const src = readRel('app/sales/quotations/builder/[id]/page.tsx');
    expect(src).toContain('QuotationBuilderApp');
    expect(src).toContain('isEdit={true}');
    expect(src).toContain('quotationId={id}');
    expect(src).toContain('existingQuotation={existingQuotationData}');
    expect(src).toContain("redirect('/sales/quotations')");
  });

  it('Proposal builder edit route awaits params (Next.js 16)', () => {
    const src = readRel('app/sales/proposals/builder/[id]/page.tsx');
    expect(src).toContain('const { id } = await params;');
    expect(src).toContain('params: Promise<{ id: string }>');
  });

  it('Quotation builder edit route awaits params (Next.js 16)', () => {
    const src = readRel('app/sales/quotations/builder/[id]/page.tsx');
    expect(src).toContain('const { id } = await params;');
    expect(src).toContain('params: Promise<{ id: string }>');
  });

  it('Proposal builder edit route imports BuilderApp from parent directory', () => {
    const src = readRel('app/sales/proposals/builder/[id]/page.tsx');
    expect(src).toContain("from '../BuilderApp'");
  });

  it('Quotation builder edit route imports BuilderApp from parent directory', () => {
    const src = readRel('app/sales/quotations/builder/[id]/page.tsx');
    expect(src).toContain("from '../BuilderApp'");
  });

  it('Proposal builder edit route loads contacts, opportunities, and proposal in parallel', () => {
    const src = readRel('app/sales/proposals/builder/[id]/page.tsx');
    expect(src).toContain('listContacts');
    expect(src).toContain('listOpportunities');
    expect(src).toContain('getProposal');
    expect(src).toContain('Promise.all([');
  });

  it('Quotation builder edit route loads contacts, opportunities, and quotation in parallel', () => {
    const src = readRel('app/sales/quotations/builder/[id]/page.tsx');
    expect(src).toContain('listContacts');
    expect(src).toContain('listOpportunities');
    expect(src).toContain('getQuotation');
    expect(src).toContain('Promise.all([');
  });

  it('Proposal builder edit route uses correct contacts response key', () => {
    const src = readRel('app/sales/proposals/builder/[id]/page.tsx');
    expect(src).toContain('(contactsResult as { contacts: unknown[] }).contacts');
    expect(src).not.toContain('(contactsResult as { proposals: unknown[] }).proposals');
  });

  it('Quotation builder edit route uses correct contacts response key', () => {
    const src = readRel('app/sales/quotations/builder/[id]/page.tsx');
    expect(src).toContain('(contactsResult as { contacts: unknown[] }).contacts');
    expect(src).not.toContain('(contactsResult as { proposals: unknown[] }).proposals');
  });

  it('Proposal builder edit route uses correct opportunities response key', () => {
    const src = readRel('app/sales/proposals/builder/[id]/page.tsx');
    expect(src).toContain('(opportunitiesResult as { opportunities: unknown[] }).opportunities');
    expect(src).not.toContain('(opportunitiesResult as { proposals: unknown[] }).proposals');
  });

  it('Quotation builder edit route uses correct opportunities response key', () => {
    const src = readRel('app/sales/quotations/builder/[id]/page.tsx');
    expect(src).toContain('(opportunitiesResult as { opportunities: unknown[] }).opportunities');
    expect(src).not.toContain('(opportunitiesResult as { proposals: unknown[] }).proposals');
  });

  it('Proposal builder edit route redirects to list when proposal not found', () => {
    const src = readRel('app/sales/proposals/builder/[id]/page.tsx');
    expect(src).toContain('if (!existingProposal)');
    expect(src).toContain("redirect('/sales/proposals')");
  });

  it('Quotation builder edit route redirects to list when quotation not found', () => {
    const src = readRel('app/sales/quotations/builder/[id]/page.tsx');
    expect(src).toContain('if (!existingQuotation)');
    expect(src).toContain("redirect('/sales/quotations')");
  });
});

describe('Future module Coming Soon routes', () => {
  it('Coming Soon component exists and accepts title, phase, description', () => {
    const src = readRel('components/layout/coming-soon.tsx');
    expect(src).toContain('export function ComingSoon');
    expect(src).toContain('title: string');
    expect(src).toContain('phase: string');
    expect(src).toContain('description?: string');
  });

  it('Invoices list route page exists (real MVP module)', () => {
    const src = readRel('app/finance/invoices/page.tsx');
    expect(src).toContain('listInvoices');
    expect(src).toContain('New Invoice');
    expect(src).toContain('/finance/invoices/new');
    expect(src).not.toContain('ComingSoon');
  });

  it('Invoices new route page exists', () => {
    const src = readRel('app/finance/invoices/new/page.tsx');
    expect(src).toContain('New Invoice');
    // The POST is issued by the Client Component the page renders.
    expect(src).toContain('NewInvoiceForm');
    const form = readRel('app/finance/invoices/new/NewInvoiceForm.tsx');
    expect(form).toContain('/api/v1/crm/invoices');
  });

  it('Invoices detail route page exists', () => {
    const src = readRel('app/finance/invoices/[id]/page.tsx');
    expect(src).toContain('getInvoice');
    // PDF export is an interactive action, so it lives in a Client Component
    // (event handlers cannot be passed from a Server Component). Assert both
    // the wiring and the labelled control so the feature is still covered.
    expect(src).toContain('ExportPdfButton');
    const button = readRel('components/invoices/export-pdf-button.tsx');
    expect(button).toContain("'use client'");
    expect(button).toContain('Export PDF');
    expect(button).toContain('printInvoice');
  });

  it('Invoices edit route page exists', () => {
    const src = readRel('app/finance/invoices/[id]/edit/page.tsx');
    expect(src).toContain('Edit Invoice');
    expect(src).toContain('EditInvoiceForm');
    const form = readRel('app/finance/invoices/[id]/edit/EditInvoiceForm.tsx');
    expect(form).toContain('/api/v1/crm/invoices/${invoice.id}');
  });
});

it('Projects list route page exists (real MVP module)', () => {
  const src = readRel('app/projects/page.tsx');
  expect(src).toContain('listProjects');
  expect(src).toContain('New Project');
  expect(src).toContain('/projects/new');
  expect(src).not.toContain('ComingSoon');
});

it('Projects new route page exists', () => {
  const src = readRel('app/projects/new/page.tsx');
  expect(src).toContain('New Project');
  expect(src).toContain('/api/v1/crm/projects');
});

it('Projects detail route page exists', () => {
  const src = readRel('app/projects/[id]/page.tsx');
  expect(src).toContain('getProject');
});

it('Automation Coming Soon route page exists', () => {
  const src = readRel('app/automation/workflows/page.tsx');
  // The page renders only its own content: the shell comes from the module
  // layout. Wrapping it in a layout here produced a second, nested shell.
  expect(src).not.toContain('DashboardClientLayout');
  expect(src).toContain('ComingSoon');
  expect(src).toContain("redirect('/login')");
  expect(src).toContain('title="Automation"');
  expect(src).toContain('Roadmap: Future Phase');

  expect(readRel('app/automation/layout.tsx')).toContain('<ModuleShell>');
});

it('Settings page is a real functional page (not Coming Soon)', () => {
  const src = readRel('app/settings/page.tsx');
  expect(src).not.toContain('ComingSoon');
  expect(src).not.toContain('Roadmap: Future Phase');
  expect(src).toContain("'use client'");

  // The six sections required by the Phase 5 brief, each saved independently.
  for (const heading of [
    'Organization Information',
    'Branding and Appearance',
    'Currency and Financial Defaults',
    'Invoice Preferences',
    'Proposal Preferences',
    'User Profile',
  ]) {
    expect(src, heading).toContain(heading);
  }

  // Currency is chosen from a searchable ISO list, not typed in by hand, and the
  // next number shown is the one the server will actually allocate.
  expect(src).toContain('Combobox');
  expect(src).toContain('listCurrencies');
  expect(src).toContain('nextNumbers.invoice.preview');
  expect(src).toContain('nextNumbers.proposal.preview');

  // Per-section saves hit the same validated endpoint.
  expect(src).toContain("'/api/v1/settings/organization'");
  expect(src).toContain("'/api/v1/settings/user'");
});

it('Future-only module routes use dynamic = force-dynamic', () => {
  const automationSrc = readRel('app/automation/workflows/page.tsx');
  expect(automationSrc).toContain("export const dynamic = 'force-dynamic'");
});

it('Sidebar navigation remains intact with all modules listed', () => {
  // The menu lives in lib/navigation.ts so every module renders the same one.
  const hrefs = NAV_SECTIONS.flatMap((section) => section.items.map((item) => item.href));
  const expected = [
    '/dashboard',
    '/crm/contacts',
    '/crm/accounts',
    '/crm/pipelines',
    '/crm/leads',
    '/crm/opportunities',
    '/sales/proposals',
    '/sales/quotations',
    '/finance/invoices',
    '/projects',
    '/projects/time-entries',
    '/documents/contracts',
    '/automation/rules',
    '/admin/users',
    '/settings',
  ];
  for (const href of expected) {
    expect(hrefs).toContain(href);
  }
});

it('Coming Soon pages do not present modules as functional', () => {
  const src = readRel('components/layout/coming-soon.tsx');
  expect(src).toContain('Coming Soon');
  expect(src).toContain('not yet available');
  expect(src).not.toContain('create');
  expect(src).not.toContain('update');
  expect(src).not.toContain('delete');
  expect(src).not.toContain('submit');
});
