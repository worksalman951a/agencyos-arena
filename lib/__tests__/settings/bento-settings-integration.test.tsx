import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  BentoSettingsView,
  type OrganizationResponse,
  type UserProfileResponse,
} from '@/components/settings/bento-settings-view';
import { BentoFeatureFlagsView } from '@/components/admin/bento-feature-flags-view';
import { BentoHealthView } from '@/components/admin/bento-health-view';
import { FeatureFlagsClient } from '@/app/admin/feature-flags/feature-flags-client';
import { HealthClient } from '@/app/admin/health/health-client';

const mockUseBentoShell = vi.fn(() => true);
vi.mock('@/components/providers/bento-theme-provider', () => ({
  useBentoShell: () => mockUseBentoShell(),
}));

const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  usePathname: () => '/settings',
}));

const mockOrg: OrganizationResponse = {
  id: 'org-test-1',
  name: 'Acme Test Agency',
  slug: 'acme-test',
  domain: 'acme.test',
  settings: {
    brandName: 'Acme Brand',
    brandColor: '#047857',
    logoUrl: 'https://cdn.example.com/logo.png',
    contactEmail: 'contact@acme.test',
    contactPhone: '+1-555-0100',
    address: '123 Test St',
    city: 'San Francisco',
    country: 'United States',
    postalCode: '94105',
    defaultCurrency: 'USD',
    dateFormat: 'MM/DD/YYYY',
    invoiceNumberPrefix: 'INV',
    invoiceNextNumber: 101,
    invoiceTaxDefault: 10,
    proposalNumberPrefix: 'PRP',
    proposalNextNumber: 50,
    proposalValidDays: 30,
  },
  nextNumbers: {
    invoice: { prefix: 'INV', nextSequence: 101, preview: 'INV-2026-0101' },
    proposal: { prefix: 'PRP', nextSequence: 50, preview: 'PRP-2026-0050' },
  },
  isAdmin: true,
};

const mockUser: UserProfileResponse = {
  id: 'user-test-1',
  email: 'admin@acme.test',
  name: 'Test Administrator',
  image: null,
  role: 'admin',
  status: 'active',
  organizationId: 'org-test-1',
};

describe('Phase 8B Bento Settings & Administration Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBentoShell.mockReturnValue(true);
  });

  it('renders BentoSettingsView with organization, branding, and numbering data', () => {
    const handleOrgSave = vi.fn();
    const handleBrandSave = vi.fn();
    const handleCurrencySave = vi.fn();
    const handleInvSave = vi.fn();
    const handlePrpSave = vi.fn();
    const handleProfileSave = vi.fn();

    render(
      <BentoSettingsView
        org={mockOrg}
        user={mockUser}
        saves={{
          organization: { status: 'idle' },
          branding: { status: 'idle' },
          currency: { status: 'idle' },
          invoice: { status: 'idle' },
          proposal: { status: 'idle' },
          profile: { status: 'idle' },
        }}
        readOnly={false}
        orgName={mockOrg.name}
        setOrgName={vi.fn()}
        contactEmail="contact@acme.test"
        setContactEmail={vi.fn()}
        contactPhone="+1-555-0100"
        setContactPhone={vi.fn()}
        address="123 Test St"
        setAddress={vi.fn()}
        city="San Francisco"
        setCity={vi.fn()}
        country="United States"
        setCountry={vi.fn()}
        postalCode="94105"
        setPostalCode={vi.fn()}
        brandName="Acme Brand"
        setBrandName={vi.fn()}
        brandColor="#047857"
        setBrandColor={vi.fn()}
        logoUrl="https://cdn.example.com/logo.png"
        setLogoUrl={vi.fn()}
        defaultCurrency="USD"
        setDefaultCurrency={vi.fn()}
        dateFormat="MM/DD/YYYY"
        setDateFormat={vi.fn()}
        currencyOptions={[{ value: 'USD', label: 'USD — US Dollar' }]}
        dateFormats={[{ value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (US)' }]}
        invoicePrefix="INV"
        setInvoicePrefix={vi.fn()}
        invoiceNextNumber="101"
        setInvoiceNextNumber={vi.fn()}
        invoiceTaxDefault="10"
        setInvoiceTaxDefault={vi.fn()}
        proposalPrefix="PRP"
        setProposalPrefix={vi.fn()}
        proposalNextNumber="50"
        setProposalNextNumber={vi.fn()}
        proposalValidDays="30"
        setProposalValidDays={vi.fn()}
        displayName="Test Administrator"
        setDisplayName={vi.fn()}
        avatarUrl=""
        setAvatarUrl={vi.fn()}
        onOrganizationSave={handleOrgSave}
        onBrandingSave={handleBrandSave}
        onCurrencySave={handleCurrencySave}
        onInvoiceSave={handleInvSave}
        onProposalSave={handlePrpSave}
        onProfileSave={handleProfileSave}
      />
    );

    expect(screen.getByText('Settings & Branding')).toBeInTheDocument();
    expect(screen.getAllByText('Organisation Profile').length).toBeGreaterThan(0);
    expect(screen.getByText('INV-2026-0101')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Acme Test Agency')).toBeInTheDocument();
  });

  it('switches navigation modules in BentoSettingsView', () => {
    render(
      <BentoSettingsView
        org={mockOrg}
        user={mockUser}
        saves={{
          organization: { status: 'idle' },
          branding: { status: 'idle' },
          currency: { status: 'idle' },
          invoice: { status: 'idle' },
          proposal: { status: 'idle' },
          profile: { status: 'idle' },
        }}
        readOnly={false}
        orgName={mockOrg.name}
        setOrgName={vi.fn()}
        contactEmail="contact@acme.test"
        setContactEmail={vi.fn()}
        contactPhone=""
        setContactPhone={vi.fn()}
        address=""
        setAddress={vi.fn()}
        city=""
        setCity={vi.fn()}
        country=""
        setCountry={vi.fn()}
        postalCode=""
        setPostalCode={vi.fn()}
        brandName="Acme Brand"
        setBrandName={vi.fn()}
        brandColor="#047857"
        setBrandColor={vi.fn()}
        logoUrl=""
        setLogoUrl={vi.fn()}
        defaultCurrency="USD"
        setDefaultCurrency={vi.fn()}
        dateFormat="MM/DD/YYYY"
        setDateFormat={vi.fn()}
        currencyOptions={[{ value: 'USD', label: 'USD — US Dollar' }]}
        dateFormats={[{ value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (US)' }]}
        invoicePrefix="INV"
        setInvoicePrefix={vi.fn()}
        invoiceNextNumber="101"
        setInvoiceNextNumber={vi.fn()}
        invoiceTaxDefault="0"
        setInvoiceTaxDefault={vi.fn()}
        proposalPrefix="PRP"
        setProposalPrefix={vi.fn()}
        proposalNextNumber="50"
        setProposalNextNumber={vi.fn()}
        proposalValidDays="30"
        setProposalValidDays={vi.fn()}
        displayName="Test Administrator"
        setDisplayName={vi.fn()}
        avatarUrl=""
        setAvatarUrl={vi.fn()}
        onOrganizationSave={vi.fn()}
        onBrandingSave={vi.fn()}
        onCurrencySave={vi.fn()}
        onInvoiceSave={vi.fn()}
        onProposalSave={vi.fn()}
        onProfileSave={vi.fn()}
      />
    );

    // Switch to Brand & Appearance
    fireEvent.click(screen.getByText('Brand & Appearance'));
    expect(screen.getByText('Brand & Visual Identity')).toBeInTheDocument();
    expect(screen.getByText('Curated Accessible Palette Swatches')).toBeInTheDocument();

    // Switch to Currency & Dates
    fireEvent.click(screen.getByText('Currency & Dates'));
    expect(screen.getByText('Currency & Regional Defaults')).toBeInTheDocument();
    expect(screen.getByText(/Currency & Historical Expense Notice:/)).toBeInTheDocument();

    // Switch to Invoice Preferences
    fireEvent.click(screen.getByText('Invoice Preferences'));
    expect(screen.getByText('Invoice Numbering & Tax Rules')).toBeInTheDocument();
    expect(screen.getAllByText('INV-2026-0101').length).toBeGreaterThan(0);
  });

  it('displays explicit currency confirmation checkbox when default currency is modified', () => {
    render(
      <BentoSettingsView
        org={mockOrg}
        user={mockUser}
        saves={{
          organization: { status: 'idle' },
          branding: { status: 'idle' },
          currency: { status: 'idle' },
          invoice: { status: 'idle' },
          proposal: { status: 'idle' },
          profile: { status: 'idle' },
        }}
        readOnly={false}
        orgName={mockOrg.name}
        setOrgName={vi.fn()}
        contactEmail="contact@acme.test"
        setContactEmail={vi.fn()}
        contactPhone=""
        setContactPhone={vi.fn()}
        address=""
        setAddress={vi.fn()}
        city=""
        setCity={vi.fn()}
        country=""
        setCountry={vi.fn()}
        postalCode=""
        setPostalCode={vi.fn()}
        brandName="Acme Brand"
        setBrandName={vi.fn()}
        brandColor="#047857"
        setBrandColor={vi.fn()}
        logoUrl=""
        setLogoUrl={vi.fn()}
        defaultCurrency="EUR" // modified from USD
        setDefaultCurrency={vi.fn()}
        dateFormat="MM/DD/YYYY"
        setDateFormat={vi.fn()}
        currencyOptions={[
          { value: 'USD', label: 'USD — US Dollar' },
          { value: 'EUR', label: 'EUR — Euro' },
        ]}
        dateFormats={[{ value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (US)' }]}
        invoicePrefix="INV"
        setInvoicePrefix={vi.fn()}
        invoiceNextNumber="101"
        setInvoiceNextNumber={vi.fn()}
        invoiceTaxDefault="0"
        setInvoiceTaxDefault={vi.fn()}
        proposalPrefix="PRP"
        setProposalPrefix={vi.fn()}
        proposalNextNumber="50"
        setProposalNextNumber={vi.fn()}
        proposalValidDays="30"
        setProposalValidDays={vi.fn()}
        displayName="Test Administrator"
        setDisplayName={vi.fn()}
        avatarUrl=""
        setAvatarUrl={vi.fn()}
        confirmCurrencyChange={false}
        setConfirmCurrencyChange={vi.fn()}
        onOrganizationSave={vi.fn()}
        onBrandingSave={vi.fn()}
        onCurrencySave={vi.fn()}
        onInvoiceSave={vi.fn()}
        onProposalSave={vi.fn()}
        onProfileSave={vi.fn()}
      />
    );

    // Switch to Currency & Dates
    fireEvent.click(screen.getByText('Currency & Dates'));
    expect(
      screen.getByText(/I confirm that changing workspace currency from/i)
    ).toBeInTheDocument();
  });

  it('renders BentoFeatureFlagsView and displays flag inspector details', () => {
    const flags = [
      {
        id: 'flag-1',
        flagKey: 'advanced_crm_analytics',
        description: 'Enables advanced predictive scoring',
        enabled: true,
        createdAt: new Date('2026-01-01'),
      },
      {
        id: 'flag-2',
        flagKey: 'beta_portal_preview',
        description: 'New interactive client portal',
        enabled: false,
        createdAt: new Date('2026-02-01'),
      },
    ];

    render(<BentoFeatureFlagsView flags={flags} />);

    expect(screen.getByText('Feature Flags Registry (2)')).toBeInTheDocument();
    expect(screen.getAllByText('advanced_crm_analytics').length).toBeGreaterThan(0);
    expect(screen.getByText('beta_portal_preview')).toBeInTheDocument();
    expect(screen.getByText('Flag Inspector')).toBeInTheDocument();
  });

  it('renders BentoHealthView with operational metrics', () => {
    const services = [
      {
        name: 'database' as const,
        status: 'healthy' as const,
        latency: 18,
      },
    ];

    render(<BentoHealthView services={services} allHealthy={true} checkedAt="12:00:00 PM" />);

    expect(screen.getByText('System Health & Diagnostics')).toBeInTheDocument();
    expect(screen.getAllByText('Operational').length).toBeGreaterThan(0);
    expect(screen.getAllByText('18ms').length).toBeGreaterThan(0);
    expect(screen.getByText('PostgreSQL Primary Cluster')).toBeInTheDocument();
  });

  it('supports legacy fallback for feature flags when useBentoShell is false', () => {
    mockUseBentoShell.mockReturnValue(false);

    const flags = [
      {
        id: 'flag-1',
        flagKey: 'legacy_test_flag',
        description: 'Testing legacy table render',
        enabled: true,
        createdAt: new Date('2026-01-01'),
      },
    ];

    render(<FeatureFlagsClient flags={flags} />);

    expect(
      screen.getByText('Enable or disable features for your organization.')
    ).toBeInTheDocument();
    expect(screen.getByText('legacy_test_flag')).toBeInTheDocument();
  });

  it('supports legacy fallback for system health when useBentoShell is false', () => {
    mockUseBentoShell.mockReturnValue(false);

    const services = [
      {
        name: 'database' as const,
        status: 'healthy' as const,
        latency: 22,
      },
    ];

    render(<HealthClient services={services} allHealthy={true} checkedAt="12:00:00 PM" />);

    expect(screen.getByText('Monitor database, queue, and storage health.')).toBeInTheDocument();
    expect(screen.getByText('● Healthy')).toBeInTheDocument();
    expect(screen.getByText('22ms')).toBeInTheDocument();
  });
});
