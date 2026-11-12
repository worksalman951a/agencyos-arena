import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { BentoDashboardView } from '@/components/dashboard/bento-dashboard-view';
import { DashboardClientView } from '@/app/dashboard/dashboard-client-view';
import * as BentoProvider from '@/components/providers/bento-theme-provider';
import type {
  Permissioned,
  DashboardMetrics,
  OpenOpportunities,
  ActivityEntry,
} from '@/lib/services/dashboard/dashboard-service';

describe('Phase 13A: Bento Dashboard View', () => {
  const mockMetrics: Permissioned<DashboardMetrics> = {
    ok: true,
    data: {
      defaultCurrency: 'USD',
      invoiceCount: 4,
      issuedInvoiceCount: 3,
      headline: {
        currency: 'USD',
        invoicedMinor: 100000,
        collectedMinor: 75000,
        outstandingMinor: 25000,
        overdueMinor: 5000,
      },
      otherCurrencies: [],
    },
  };

  const mockOpportunities: Permissioned<OpenOpportunities> = {
    ok: true,
    data: {
      count: 2,
      defaultCurrency: 'USD',
      defaultCurrencyValueMinor: 45000,
    },
  };

  const mockActivity: Permissioned<ActivityEntry[]> = {
    ok: true,
    data: [
      {
        id: 'act-1',
        action: 'invoice.create',
        entityType: 'Invoice',
        entityId: 'inv-1',
        actorName: 'Salman Ashraf',
        createdAt: new Date(),
      },
    ],
  };

  it('renders Bento executive dashboard with live metrics', () => {
    render(
      <BentoDashboardView
        metrics={mockMetrics}
        opportunities={mockOpportunities}
        activity={mockActivity}
        canCreateProject={true}
        canReadProjects={true}
      />
    );

    expect(screen.getByText('Executive Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Capital Inflow & Realization')).toBeInTheDocument();
    expect(screen.getByText('Sales Pipeline Value')).toBeInTheDocument();
    expect(screen.getByText('Real-Time Workspace Activity')).toBeInTheDocument();
    expect(screen.getByText('Salman Ashraf')).toBeInTheDocument();
  });

  it('DashboardClientView toggles between Bento and legacy view based on BentoShell context', () => {
    // 1. Bento enabled
    vi.spyOn(BentoProvider, 'useBentoShell').mockReturnValue(true);
    const { unmount } = render(
      <DashboardClientView
        metrics={mockMetrics}
        opportunities={mockOpportunities}
        activity={mockActivity}
        canCreateProject={true}
        canReadProjects={true}
      />
    );
    expect(screen.getByText('Executive Dashboard')).toBeInTheDocument();
    unmount();

    // 2. Bento disabled (explicit opt-out)
    vi.spyOn(BentoProvider, 'useBentoShell').mockReturnValue(false);
    render(
      <DashboardClientView
        metrics={mockMetrics}
        opportunities={mockOpportunities}
        activity={mockActivity}
        canCreateProject={true}
        canReadProjects={true}
      />
    );
    expect(screen.getByText('Financial summary in USD')).toBeInTheDocument();
    expect(screen.queryByText('Capital Inflow & Realization')).not.toBeInTheDocument();
  });
});
