/**
 * Invoice workflow regression tests (list, create, detail, edit, export).
 *
 * The list page previously fetched its own API from a Server Component and
 * swallowed the failure (`if (!res.ok) return []`), so an authorization error or
 * a database outage rendered as "No invoices found". The create page asked for a
 * raw contact CUID, and the edit page showed "Loading invoice…" forever when its
 * browser fetch failed while offering edits of paid invoices.
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';

import { NewInvoiceForm } from '@/app/finance/invoices/new/NewInvoiceForm';
import { EditInvoiceForm } from '@/app/finance/invoices/[id]/edit/EditInvoiceForm';
import { useToast } from '@/components/ui/use-toast';

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

const invoice = {
  id: 'inv_1',
  number: 'INV-0001',
  title: 'Website redesign',
  status: 'draft',
  currency: 'USD',
  dueDate: '2026-12-01T00:00:00.000Z',
  notes: null,
  clientId: 'contact_1',
  items: [{ description: 'Design', quantity: '2', unitPrice: '100', taxRate: '0' }],
};

describe('invoices list page', () => {
  const src = read('app/finance/invoices/page.tsx');

  it('loads through the service layer and renders authorization outcomes', () => {
    expect(src).toContain('loadPageData');
    expect(src).toContain('PageStateNotice');
    expect(src).toContain('listInvoices');
    expect(src).not.toContain('ComingSoon');
  });

  it('separates an empty result from an unfiltered empty state', () => {
    expect(src).toContain('No invoices match these filters.');
    expect(src).toContain('No invoices yet.');
  });

  it('keeps search, status filtering, sorting and pagination in the URL', () => {
    expect(src).toContain('name="search"');
    expect(src).toContain('name="status"');
    expect(src).toContain('sortBy');
    expect(src).toContain('Previous');
    expect(src).toContain('Next');
    expect(src).toContain('/finance/invoices/new');
  });
});

describe('new invoice page', () => {
  const page = read('app/finance/invoices/new/page.tsx');
  const form = read('app/finance/invoices/new/NewInvoiceForm.tsx');

  it('resolves selectable clients on the server instead of asking for a CUID', () => {
    expect(page).not.toContain("'use client'");
    expect(page).toContain('listContacts');
    expect(page).toContain('NewInvoiceForm');
    expect(form).not.toContain('Client contact ID (CUID)');
    expect(form).not.toContain('Contact CUID');
    expect(form).toContain('<select');
  });

  it('posts to the invoice API with credentials and surfaces failures', () => {
    expect(form).toContain("'/api/v1/crm/invoices'");
    expect(form).toContain("credentials: 'include'");
    expect(form).toContain('res.status === 401');
    expect(form).toContain("variant: 'destructive'");
  });
});

describe('invoice detail and edit pages', () => {
  const detail = read('app/finance/invoices/[id]/page.tsx');
  const edit = read('app/finance/invoices/[id]/edit/page.tsx');

  it('detail renders not-found/permission states instead of throwing', () => {
    expect(detail).toContain('loadPageData');
    expect(detail).toContain('PageStateNotice');
    expect(detail).toContain('ExportPdfButton');
  });

  it('detail only offers Edit to users who can update an editable invoice', () => {
    expect(detail).toContain('getCurrentPermissions');
    expect(detail).toContain("permissions.has('invoice.update')");
    expect(detail).toContain('isEditable');
  });

  it('edit page validates permissions and status server-side', () => {
    expect(edit).not.toContain("'use client'");
    expect(edit).toContain('loadPageData');
    expect(edit).toContain("permissions.has('invoice.update')");
    expect(edit).toContain('can no longer be edited');
    expect(edit).toContain('EditInvoiceForm');
  });

  it('PDF export stays a real client-side action', () => {
    const button = read('components/invoices/export-pdf-button.tsx');
    expect(button).toContain("'use client'");
    expect(button).toContain('Export PDF');
    expect(button).toContain('printInvoice');
  });
});

describe('NewInvoiceForm', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockPush.mockReset();
    mockFetch.mockReset();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => cleanup());

  it('lists the clients resolved by the server', () => {
    render(<NewInvoiceForm contacts={contacts} />);

    expect(screen.getByRole('option', { name: 'Jane Smith' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Acme Ltd' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'No client' })).toBeInTheDocument();
  });

  it('submits a valid payload and opens the created invoice', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 'inv_42' }),
    });

    render(<NewInvoiceForm contacts={contacts} />);

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Brand refresh' } });
    fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'contact_2' } });
    fireEvent.change(screen.getByLabelText('Line 1 description'), {
      target: { value: 'Logo design' },
    });

    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Create Invoice' }).closest('form')!);
    });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/v1/crm/invoices');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');

    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ clientId: 'contact_2', title: 'Brand refresh', status: 'draft' });
    expect(body.lineItems).toHaveLength(1);
    expect(body.lineItems[0]).toMatchObject({ description: 'Logo design' });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/finance/invoices/inv_42'));
  });

  it('reports a forbidden response instead of silently doing nothing', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden' }),
    });

    const toasts = renderHook(() => useToast());

    render(<NewInvoiceForm contacts={contacts} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Should fail' } });
    fireEvent.change(screen.getByLabelText('Line 1 description'), { target: { value: 'X' } });

    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Create Invoice' }).closest('form')!);
    });

    await waitFor(() => expect(toasts.result.current.toasts.length).toBeGreaterThan(0));
    expect(toasts.result.current.toasts[0]).toMatchObject({
      variant: 'destructive',
      description: 'You do not have permission to create invoices.',
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('sends the user to the login page when the session expired', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });

    render(<NewInvoiceForm contacts={contacts} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Expired' } });
    fireEvent.change(screen.getByLabelText('Line 1 description'), { target: { value: 'X' } });

    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Create Invoice' }).closest('form')!);
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/login'));
  });
});

describe('EditInvoiceForm', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockPush.mockReset();
    mockFetch.mockReset();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => cleanup());

  it('only offers the transitions the service accepts', () => {
    render(
      <EditInvoiceForm
        invoice={invoice}
        contacts={contacts}
        statusOptions={[
          { value: 'draft', label: 'Draft' },
          { value: 'sent', label: 'Sent' },
        ]}
      />
    );

    const status = screen.getByLabelText('Status');
    expect(status).toHaveValue('draft');
    expect(screen.getAllByRole('option').map((o) => (o as HTMLOptionElement).value)).toEqual(
      expect.arrayContaining(['draft', 'sent'])
    );
  });

  it('saves with PUT and returns to the detail page', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

    render(
      <EditInvoiceForm
        invoice={invoice}
        contacts={contacts}
        statusOptions={[{ value: 'draft', label: 'Draft' }]}
      />
    );

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Renamed' } });

    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Save Changes' }).closest('form')!);
    });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/v1/crm/invoices/inv_1');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toMatchObject({ title: 'Renamed', status: 'draft' });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/finance/invoices/inv_1'));
  });
});
