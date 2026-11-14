/**
 * Project-to-invoice UI tests (Phase 5A).
 *
 * Covers the handoff from a project workspace to the existing new-invoice form,
 * the project selector on the create/edit forms, and the page wiring that keeps
 * those screens on the service layer. Server-side enforcement is covered in
 * lib/__tests__/crm/invoice-project-link.test.ts and the PostgreSQL suite.
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { NewInvoiceForm } from '@/app/finance/invoices/new/NewInvoiceForm';
import { EditInvoiceForm } from '@/app/finance/invoices/[id]/edit/EditInvoiceForm';
import { BentoShellProvider } from '@/components/providers/bento-theme-provider';
import { BentoInvoicesView } from '@/components/finance/bento-invoices-view';
import { InvoicesClient } from '@/app/finance/invoices/invoices-client';

const mockPush = vi.fn();
// Mutable so a test can describe the query string the user arrived with.
const mockSearchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
  usePathname: () => '/finance/invoices',
  useSearchParams: () => mockSearchParams,
}));

const ROOT = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

const contacts = [
  { id: 'contact_1', label: 'Jane Smith' },
  { id: 'contact_2', label: 'Acme Ltd' },
];
const projects = [
  { id: 'project_1', label: 'Apollo Launch' },
  { id: 'project_2', label: 'Brand Refresh' },
];

const invoice = {
  id: 'inv_1',
  number: 'INV-0001',
  title: 'Website redesign',
  status: 'draft',
  currency: 'EUR',
  dueDate: null,
  notes: null,
  clientId: 'contact_1',
  projectId: 'project_1',
  items: [{ description: 'Design', quantity: '2', unitPrice: '100', taxRate: '0' }],
};

const mockFetch = vi.fn();

beforeEach(() => {
  mockPush.mockReset();
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 'inv_42' }) });
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => cleanup());

async function submit(buttonName: string) {
  await act(async () => {
    fireEvent.submit(screen.getByRole('button', { name: buttonName }).closest('form')!);
  });
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  return JSON.parse(mockFetch.mock.calls[0][1].body) as Record<string, unknown>;
}

describe('NewInvoiceForm project selection', () => {
  it('preselects the project and client handed over from a project workspace', async () => {
    render(
      <NewInvoiceForm
        contacts={contacts}
        projects={projects}
        defaultProjectId="project_2"
        defaultClientId="contact_2"
      />
    );

    expect(screen.getByLabelText('Project')).toHaveValue('project_2');
    expect(screen.getByLabelText('Client')).toHaveValue('contact_2');

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Milestone 1' } });
    fireEvent.change(screen.getByLabelText('Line 1 description'), { target: { value: 'Work' } });
    const body = await submit('Create Invoice');

    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/crm/invoices');
    expect(body).toMatchObject({ projectId: 'project_2', clientId: 'contact_2' });
    // The organization is never part of the request; the server resolves it.
    expect(body).not.toHaveProperty('organizationId');
  });

  it('creates an invoice without a project when none is chosen', async () => {
    render(<NewInvoiceForm contacts={contacts} projects={projects} />);

    expect(screen.getByLabelText('Project')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Retainer' } });
    fireEvent.change(screen.getByLabelText('Line 1 description'), { target: { value: 'Work' } });
    const body = await submit('Create Invoice');

    expect(body).not.toHaveProperty('projectId');
  });

  it('ignores a preselection the server did not offer', () => {
    render(
      <NewInvoiceForm contacts={contacts} projects={projects} defaultProjectId="project_foreign" />
    );

    expect(screen.getByLabelText('Project')).toHaveValue('');
    expect(screen.queryByRole('option', { name: 'project_foreign' })).not.toBeInTheDocument();
  });

  it('lets the user change or clear the handed-over project', async () => {
    render(<NewInvoiceForm contacts={contacts} projects={projects} defaultProjectId="project_1" />);

    fireEvent.change(screen.getByLabelText('Project'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Unlinked' } });
    fireEvent.change(screen.getByLabelText('Line 1 description'), { target: { value: 'Work' } });
    const body = await submit('Create Invoice');

    expect(body).not.toHaveProperty('projectId');
  });

  it('still works when no project can be offered', () => {
    render(<NewInvoiceForm contacts={contacts} />);

    expect(screen.getByLabelText('Project')).toHaveValue('');
    expect(screen.getByText(/No projects are available to link/)).toBeInTheDocument();
  });
});

/**
 * Regression: the Bento shell is on by default in production, so it is the view
 * real users get. It used to render no project selector at all, which silently
 * dropped the project handoff from a project workspace (the field is only sent
 * when the form state has a project). These render through `BentoShellProvider`
 * because `useBentoShell` defaults to `false` in tests.
 */
describe('NewInvoiceForm project selection in the Bento shell', () => {
  const bento = (ui: React.ReactElement) =>
    render(<BentoShellProvider isBento>{ui}</BentoShellProvider>);

  it('preselects the handed-over project in the Bento form view', async () => {
    bento(<NewInvoiceForm contacts={contacts} projects={projects} defaultProjectId="project_1" />);

    expect(screen.getByLabelText('Project')).toHaveValue('project_1');
    expect(screen.getByRole('option', { name: 'Apollo Launch' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Invoice Title/), {
      target: { value: 'Bento handoff' },
    });
    fireEvent.change(screen.getByLabelText('Line 1 description'), { target: { value: 'Work' } });

    // The Bento submit control sits in the page header, outside the <form>.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create Invoice' }));
    });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const body = JSON.parse(mockFetch.mock.calls[0][1].body) as Record<string, unknown>;

    expect(body).toHaveProperty('projectId', 'project_1');
  });

  it('does not preselect a project the server did not offer', () => {
    bento(<NewInvoiceForm contacts={contacts} projects={projects} defaultProjectId="foreign" />);

    expect(screen.getByLabelText('Project')).toHaveValue('');
    expect(screen.queryByRole('option', { name: 'foreign' })).not.toBeInTheDocument();
  });

  it('keeps the project selector on the Bento form when no project is offered', () => {
    bento(<NewInvoiceForm contacts={contacts} />);

    expect(screen.getByLabelText('Project')).toHaveValue('');
    expect(screen.getByText(/No projects are available to link/)).toBeInTheDocument();
  });
});

describe('EditInvoiceForm project selection', () => {
  const statusOptions = [{ value: 'draft', label: 'Draft' }];

  it('sends a project change while the invoice has no payments', async () => {
    render(
      <EditInvoiceForm
        invoice={invoice}
        contacts={contacts}
        projects={projects}
        canChangeProject
        statusOptions={statusOptions}
      />
    );

    const select = screen.getByLabelText('Project');
    expect(select).toHaveValue('project_1');
    expect(select).toBeEnabled();

    fireEvent.change(select, { target: { value: 'project_2' } });
    const body = await submit('Save Changes');

    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/crm/invoices/inv_1');
    expect(body).toMatchObject({ projectId: 'project_2', currency: 'EUR' });
  });

  it('sends null to unlink', async () => {
    render(
      <EditInvoiceForm
        invoice={invoice}
        contacts={contacts}
        projects={projects}
        canChangeProject
        statusOptions={statusOptions}
      />
    );

    fireEvent.change(screen.getByLabelText('Project'), { target: { value: '' } });
    const body = await submit('Save Changes');

    expect(body).toHaveProperty('projectId', null);
  });

  it('locks the selector and omits the field once payments are recorded', async () => {
    render(
      <EditInvoiceForm
        invoice={invoice}
        contacts={contacts}
        projects={projects}
        canChangeProject={false}
        statusOptions={statusOptions}
      />
    );

    expect(screen.getByLabelText('Project')).toBeDisabled();
    expect(screen.getByText(/cannot be changed once payments have been recorded/)).toBeVisible();

    const body = await submit('Save Changes');
    expect(body).not.toHaveProperty('projectId');
  });
});

describe('project/invoice page wiring', () => {
  const projectPage = read('app/projects/[id]/page.tsx');
  const newPage = read('app/finance/invoices/new/page.tsx');
  const listPage = read('app/finance/invoices/page.tsx');
  const detailPage = read('app/finance/invoices/[id]/page.tsx');
  const editPage = read('app/finance/invoices/[id]/edit/page.tsx');

  it('project workspace lists related invoices through the invoice service', () => {
    expect(projectPage).toContain('listInvoices');
    expect(projectPage).toContain('projectId: id');
    // The section is rendered only when the invoice service authorized the read.
    expect(projectPage).toContain('invoicesResult.ok &&');
    expect(projectPage).not.toContain('prisma.');
  });

  it('project workspace hands off to the existing new-invoice page', () => {
    expect(projectPage).toContain('/finance/invoices/new?projectId=');
    expect(projectPage).toContain("permissions.has('invoice.create')");
    expect(projectPage).toContain("project.status !== 'archived'");
    expect(projectPage).toContain('/finance/invoices?projectId=');
  });

  it('new-invoice page only honours a project the project service returned', () => {
    expect(newPage).not.toContain("'use client'");
    expect(newPage).toContain('listProjectOptions');
    expect(newPage).toContain('projects.find((project) => project.id === requestedProjectId)');
    expect(newPage).toContain('invoice-project-unavailable');
    // One form, reused: the handoff adds no second creation path.
    expect(newPage).toContain('<NewInvoiceForm');
    expect(newPage).not.toContain('createInvoice');
  });

  it('invoice list filters by project in the URL and shows the project column', () => {
    expect(listPage).toContain('searchParams.projectId');
    expect(listPage).toContain('projectId: projectId || undefined');
    expect(listPage).toContain('name="projectId"');
    expect(listPage).toContain("{ label: 'Project' }");
  });

  it('invoice detail shows the project, and the edit page locks it after payments', () => {
    expect(detailPage).toContain('invoice.project.name');
    expect(detailPage).toContain('/projects/${invoice.project.id}');
    expect(editPage).toContain('canChangeProject={invoice.payments.length === 0}');
  });
});

/**
 * The project filter on the Bento invoice list.
 *
 * Arriving from Project Workspace -> Invoices -> "View all" lands on
 * `/finance/invoices?projectId=<id>`. The server has already applied that filter
 * and decided which projects the caller may see; this control only reports the
 * active project and navigates when it changes. Selecting or clearing it must
 * carry the other filters over and reset pagination.
 */
describe('invoice list project filter in the Bento shell', () => {
  const projectOptions = [
    { id: 'project_1', name: 'Apollo Launch', archived: false },
    { id: 'project_2', name: 'Brand Refresh', archived: true },
  ];

  const listInvoices = [
    {
      id: 'inv_1',
      number: 'INV-0001',
      title: 'Website redesign',
      status: 'draft',
      total: '300.00',
      subtotal: '300.00',
      tax: '0.00',
      currency: 'USD',
      dueDate: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      clientId: 'contact_1',
      client: { id: 'contact_1', firstName: 'Jane', lastName: 'Smith' },
      projectId: 'project_1',
      project: { id: 'project_1', name: 'Apollo Launch' },
      payments: [],
    },
  ] as never;

  const view = (overrides: Record<string, unknown> = {}) =>
    render(
      <BentoShellProvider isBento>
        <BentoInvoicesView
          invoices={listInvoices}
          total={1}
          totalPages={1}
          page={1}
          searchVal=""
          statusFilter=""
          projectIdFilter=""
          projectOptions={projectOptions}
          sortBy="createdAt"
          sortOrder="desc"
          onSearchChange={vi.fn()}
          onStatusFilterChange={vi.fn()}
          onProjectFilterChange={vi.fn()}
          {...overrides}
        />
      </BentoShellProvider>
    );

  beforeEach(() => {
    mockPush.mockReset();
    for (const key of [...mockSearchParams.keys()]) mockSearchParams.delete(key);
  });

  afterEach(() => cleanup());

  it('offers an accessible project filter that shows the handed-over project', () => {
    view({ projectIdFilter: 'project_1' });

    // Reachable by its label (screen readers and `getByLabel` both work).
    const select = screen.getByLabelText('Filter by project');
    expect(select).toHaveValue('project_1');
    expect(select.tagName).toBe('SELECT');

    // The active project is the one the URL/server selected.
    expect(screen.getByRole('option', { name: 'Apollo Launch' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'All Projects' })).toBeInTheDocument();
    // Archived projects stay filterable - existing invoices still reference them.
    expect(screen.getByRole('option', { name: 'Brand Refresh (archived)' })).toBeInTheDocument();
  });

  it('renders exactly the invoices the server scoped to the active project', () => {
    // The list is already filtered server-side, so the view must show every row
    // it was handed and must not reach for anything else.
    view({ projectIdFilter: 'project_1' });

    // Row + detail panel both show the linked invoice.
    expect(screen.getAllByText('#INV-0001').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Website redesign').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Unrelated invoice')).not.toBeInTheDocument();
  });

  it('navigates with the project while preserving search, status and resetting pagination', () => {
    mockSearchParams.set('search', 'website');
    mockSearchParams.set('status', 'draft');
    mockSearchParams.set('page', '2');
    mockSearchParams.set('sortBy', 'title');

    const onProjectFilterChange = vi.fn();
    view({ onProjectFilterChange });

    fireEvent.change(screen.getByLabelText('Filter by project'), {
      target: { value: 'project_2' },
    });

    // The view only reports the change; the container owns the navigation.
    expect(onProjectFilterChange).toHaveBeenCalledWith('project_2');
  });

  it('keeps a URL-only project visible instead of showing no filter', () => {
    // The caller cannot be offered this project (deleted, other tenant, or past
    // the option limit), yet the list is still filtered by it. The control must
    // not fall back to "All Projects" and imply nothing is filtered.
    view({ projectIdFilter: 'project_foreign' });

    const select = screen.getByLabelText('Filter by project');
    expect(select).toHaveValue('project_foreign');
    expect(screen.getByRole('option', { name: 'Unavailable project' })).toBeInTheDocument();
    // The unknown id is never named as a real project - the placeholder is not
    // a leaked project name, and the authorized options are untouched.
    expect(screen.queryByRole('option', { name: 'project_foreign' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Apollo Launch' })).toBeInTheDocument();
  });

  it('renders a labelled control even when no project is offered', () => {
    view({ projectOptions: [] });

    const select = screen.getByLabelText('Filter by project');
    expect(select).toHaveValue('');
    expect(screen.getByRole('option', { name: 'All Projects' })).toBeInTheDocument();
  });
});

/**
 * The container owns the navigation: `InvoicesClient` turns a filter change into
 * a new query string. Selecting a project must preserve the search and status
 * filters, keep other context (sort order, client) and reset pagination;
 * clearing it must drop the parameter entirely.
 */
describe('invoice list project filter navigates without losing the other filters', () => {
  const client = (overrides: Record<string, unknown> = {}) =>
    render(
      <BentoShellProvider isBento>
        <InvoicesClient
          invoices={[]}
          total={0}
          totalPages={3}
          page={2}
          searchVal="website"
          statusFilter="draft"
          projectIdFilter=""
          projectOptions={[{ id: 'project_1', name: 'Apollo Launch', archived: false }]}
          sortBy="title"
          sortOrder="asc"
          {...overrides}
        />
      </BentoShellProvider>
    );

  beforeEach(() => {
    mockPush.mockReset();
    for (const key of [...mockSearchParams.keys()]) mockSearchParams.delete(key);
    mockSearchParams.set('search', 'website');
    mockSearchParams.set('status', 'draft');
    mockSearchParams.set('page', '2');
    mockSearchParams.set('sortBy', 'title');
  });

  afterEach(() => cleanup());

  it('keeps search and status and resets pagination when a project is selected', () => {
    client();

    fireEvent.change(screen.getByLabelText('Filter by project'), {
      target: { value: 'project_1' },
    });

    expect(mockPush).toHaveBeenCalledTimes(1);
    const url = new URL(mockPush.mock.calls[0][0] as string, 'http://localhost');

    expect(url.pathname).toBe('/finance/invoices');
    expect(url.searchParams.get('projectId')).toBe('project_1');
    expect(url.searchParams.get('search')).toBe('website');
    expect(url.searchParams.get('status')).toBe('draft');
    expect(url.searchParams.get('sortBy')).toBe('title');
    expect(url.searchParams.get('page')).toBe('1');
  });

  it('drops the project parameter when the filter is cleared', () => {
    mockSearchParams.set('projectId', 'project_1');
    client({ projectIdFilter: 'project_1' });

    fireEvent.change(screen.getByLabelText('Filter by project'), { target: { value: '' } });

    const url = new URL(mockPush.mock.calls[0][0] as string, 'http://localhost');
    expect(url.searchParams.has('projectId')).toBe(false);
    // Clearing one filter preserves the others.
    expect(url.searchParams.get('search')).toBe('website');
    expect(url.searchParams.get('status')).toBe('draft');
    expect(url.searchParams.get('page')).toBe('1');
  });

  it('returns to the bare list URL when the last filter is cleared', () => {
    for (const key of [...mockSearchParams.keys()]) mockSearchParams.delete(key);
    mockSearchParams.set('projectId', 'project_1');
    client({ searchVal: '', statusFilter: '', projectIdFilter: 'project_1' });

    fireEvent.change(screen.getByLabelText('Filter by project'), { target: { value: '' } });

    expect(mockPush).toHaveBeenCalledWith('/finance/invoices');
  });
});
