/**
 * Phase 5B-1 Time Entry UI tests.
 *
 * Verifies form payload assembly, archived project guards, non-admin
 * ownership presentation, and billing rate / currency controls.
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { NewTimeEntryForm } from '@/app/projects/time-entries/new/NewTimeEntryForm';
import { EditTimeEntryForm } from '@/app/projects/time-entries/[id]/EditTimeEntryForm';

const mockPush = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
  useSearchParams: () => currentSearchParams,
}));

const mockFetch = vi.fn();

beforeEach(() => {
  mockPush.mockReset();
  mockFetch.mockReset();
  currentSearchParams = new URLSearchParams();
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => cleanup());

const projectsPayload = {
  projects: [
    {
      id: 'proj_active',
      name: 'Apollo Launch',
      status: 'active',
      deletedAt: null,
      tasks: [{ id: 'task_1', title: 'Build API' }],
    },
    {
      id: 'proj_archived',
      name: 'Legacy Archive',
      status: 'archived',
      deletedAt: null,
      tasks: [{ id: 'task_arch', title: 'Old Task' }],
    },
  ],
};

describe('NewTimeEntryForm', () => {
  it('submits direct projectId, hourlyRate, and currency without organizationId', async () => {
    currentSearchParams = new URLSearchParams('projectId=proj_active');
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ members: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => projectsPayload })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ id: 'te_new' }),
      });

    render(<NewTimeEntryForm defaultCurrency="EUR" isAdmin={true} />);

    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Apollo Launch' })).toBeInTheDocument()
    );
    expect(screen.queryByRole('option', { name: 'Legacy Archive' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Project')).toHaveValue('proj_active');
    expect(screen.getByLabelText('Currency')).toHaveValue('EUR');

    fireEvent.change(screen.getByLabelText('Hours'), { target: { value: '2.5' } });
    fireEvent.change(screen.getByLabelText('Hourly Rate (optional)'), {
      target: { value: '150.00' },
    });
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'USD' } });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Architecture session' },
    });

    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Log Time Entry' }).closest('form')!);
    });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
    const postCall = mockFetch.mock.calls[2];
    expect(postCall[0]).toBe('/api/v1/projects/time-entries');
    const body = JSON.parse(postCall[1].body) as Record<string, unknown>;
    expect(body).toMatchObject({
      projectId: 'proj_active',
      taskId: null,
      hours: '2.5',
      billable: true,
      hourlyRate: '150.00',
      currency: 'USD',
    });
    expect(body).not.toHaveProperty('organizationId');
  });

  it('refuses to preselect an archived project and hides member selector from non-admins', async () => {
    currentSearchParams = new URLSearchParams('projectId=proj_archived');
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => projectsPayload });

    render(<NewTimeEntryForm defaultCurrency="USD" isAdmin={false} />);

    await waitFor(() =>
      expect(
        screen.getByText(/Project "Legacy Archive" is archived and cannot accept new time entries/i)
      ).toBeInTheDocument()
    );
    expect(screen.getByLabelText('Project')).toHaveValue('');
    expect(screen.getByLabelText('Team Member')).toBeDisabled();
  });

  it('clears/omits hourlyRate and currency when billable is unchecked', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => projectsPayload })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ id: 'te_nonbill' }),
      });

    render(<NewTimeEntryForm defaultCurrency="USD" isAdmin={false} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Hours'), { target: { value: '1.5' } });
    fireEvent.change(screen.getByLabelText('Hourly Rate (optional)'), {
      target: { value: '200' },
    });
    fireEvent.click(screen.getByLabelText('Billable hours'));

    expect(screen.queryByLabelText('Hourly Rate (optional)')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Log Time Entry' }).closest('form')!);
    });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    const body = JSON.parse(mockFetch.mock.calls[1][1].body) as Record<string, unknown>;
    expect(body.billable).toBe(false);
    expect(body).not.toHaveProperty('hourlyRate');
    expect(body).not.toHaveProperty('currency');
  });
});

describe('EditTimeEntryForm', () => {
  it('shows read-only view without save or delete for another user entry when non-admin', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'te_other',
          userId: 'user_other',
          projectId: 'proj_active',
          taskId: null,
          date: '2026-06-01T00:00:00.000Z',
          hours: '3',
          description: 'Other person work',
          billable: true,
          hourlyRate: '100.00',
          currency: 'USD',
          billableAmount: '300.00',
          user: { id: 'user_other', name: 'Bob', email: 'bob@agency.test' },
          project: { id: 'proj_active', name: 'Apollo Launch', status: 'active', deleted: false },
          task: null,
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => projectsPayload });

    render(
      <EditTimeEntryForm
        entryId="te_other"
        currentUserId="user_self"
        isAdmin={false}
        canUpdate={true}
        canDelete={true}
        defaultCurrency="USD"
      />
    );

    await waitFor(() => expect(screen.getByText(/Read-only view/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });
});

describe('Phase 5B-1 page wiring', () => {
  const read = (relativePath: string) =>
    fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

  it('guards + Log Time on active non-deleted projects and renders multi-currency summaries', () => {
    const projectPage = read('app/projects/[id]/page.tsx');
    expect(projectPage).toContain("permissions.has('time.entry.create')");
    expect(projectPage).toContain("project.status !== 'archived'");
    expect(projectPage).toContain('billableAmountsByCurrency');

    const timeEntriesPage = read('app/projects/time-entries/page.tsx');
    expect(timeEntriesPage).toContain('summarizeTimeEntries');
    expect(timeEntriesPage).toContain('formatMinorUnitsAsCurrency');
  });
});
