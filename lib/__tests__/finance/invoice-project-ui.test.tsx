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

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
  usePathname: () => '/finance/invoices',
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
