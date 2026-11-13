'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Building2,
  Palette,
  CreditCard,
  FileText,
  User,
  Save,
  Check,
  Shield,
  Sparkles,
  Sun,
  Moon,
  Laptop,
  Users,
  ScrollText,
  Flag,
  Activity,
  Bell,
  KeyRound,
  Database,
  Sliders,
  ExternalLink,
} from 'lucide-react';

import { Panel, StatStrip, StatusPill } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { BRAND_SWATCHES } from '@/lib/branding-constants';
import { contrastRatio, readableForeground, resolveBrandTheme } from '@/lib/branding';
import { useTheme } from '@/components/providers/theme-provider';

export interface OrganizationSettings {
  brandName?: string | null;
  brandColor?: string | null;
  logoUrl?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  postalCode?: string | null;
  defaultCurrency?: string;
  dateFormat?: string;
  invoiceNumberPrefix?: string;
  invoiceNextNumber?: number;
  invoiceTaxDefault?: number;
  proposalNumberPrefix?: string;
  proposalNextNumber?: number;
  proposalValidDays?: number;
}

export interface NumberingPreview {
  prefix: string;
  nextSequence: number;
  preview: string;
}

export interface OrganizationResponse {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  settings: OrganizationSettings;
  nextNumbers: { invoice: NumberingPreview; proposal: NumberingPreview };
  isAdmin: boolean;
}

export interface UserProfileResponse {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: string;
  status: string;
  organizationId: string | null;
}

export type SectionKey =
  'organization' | 'branding' | 'appearance' | 'currency' | 'invoice' | 'proposal' | 'profile';

export interface SaveState {
  status: 'idle' | 'saving' | 'success' | 'error';
  message?: string;
  fieldErrors?: Record<string, string>;
}

interface BentoSettingsViewProps {
  org: OrganizationResponse;
  user: UserProfileResponse;
  saves: Record<SectionKey, SaveState>;
  readOnly: boolean;

  // Organization fields
  orgName: string;
  setOrgName: (val: string) => void;
  contactEmail: string;
  setContactEmail: (val: string) => void;
  contactPhone: string;
  setContactPhone: (val: string) => void;
  address: string;
  setAddress: (val: string) => void;
  city: string;
  setCity: (val: string) => void;
  country: string;
  setCountry: (val: string) => void;
  postalCode: string;
  setPostalCode: (val: string) => void;

  // Branding fields
  brandName: string;
  setBrandName: (val: string) => void;
  brandColor: string;
  setBrandColor: (val: string) => void;
  logoUrl: string;
  setLogoUrl: (val: string) => void;

  // Currency fields
  defaultCurrency: string;
  setDefaultCurrency: (val: string) => void;
  dateFormat: string;
  setDateFormat: (val: string) => void;
  currencyOptions: ComboboxOption[];
  dateFormats: Array<{ value: string; label: string }>;

  // Invoice fields
  invoicePrefix: string;
  setInvoicePrefix: (val: string) => void;
  invoiceNextNumber: string;
  setInvoiceNextNumber: (val: string) => void;
  invoiceTaxDefault: string;
  setInvoiceTaxDefault: (val: string) => void;

  // Proposal fields
  proposalPrefix: string;
  setProposalPrefix: (val: string) => void;
  proposalNextNumber: string;
  setProposalNextNumber: (val: string) => void;
  proposalValidDays: string;
  setProposalValidDays: (val: string) => void;

  // Profile fields
  displayName: string;
  setDisplayName: (val: string) => void;
  avatarUrl: string;
  setAvatarUrl: (val: string) => void;

  // Currency confirmation
  confirmCurrencyChange?: boolean;
  setConfirmCurrencyChange?: (val: boolean) => void;

  // Handlers
  onOrganizationSave: (e: React.FormEvent) => void;
  onBrandingSave: (e: React.FormEvent) => void;
  onCurrencySave: (e: React.FormEvent) => void;
  onInvoiceSave: (e: React.FormEvent) => void;
  onProposalSave: (e: React.FormEvent) => void;
  onProfileSave: (e: React.FormEvent) => void;
}

export function BentoSettingsView({
  org,
  user,
  saves,
  readOnly,
  orgName,
  setOrgName,
  contactEmail,
  setContactEmail,
  contactPhone,
  setContactPhone,
  address,
  setAddress,
  city,
  setCity,
  country,
  setCountry,
  postalCode,
  setPostalCode,
  brandName,
  setBrandName,
  brandColor,
  setBrandColor,
  logoUrl,
  setLogoUrl,
  defaultCurrency,
  setDefaultCurrency,
  dateFormat,
  setDateFormat,
  currencyOptions,
  dateFormats,
  invoicePrefix,
  setInvoicePrefix,
  invoiceNextNumber,
  setInvoiceNextNumber,
  invoiceTaxDefault,
  setInvoiceTaxDefault,
  proposalPrefix,
  setProposalPrefix,
  proposalNextNumber,
  setProposalNextNumber,
  proposalValidDays,
  setProposalValidDays,
  displayName,
  setDisplayName,
  avatarUrl,
  setAvatarUrl,
  confirmCurrencyChange = false,
  setConfirmCurrencyChange,
  onOrganizationSave,
  onBrandingSave,
  onCurrencySave,
  onInvoiceSave,
  onProposalSave,
  onProfileSave,
}: BentoSettingsViewProps) {
  const [activeSection, setActiveSection] = React.useState<SectionKey>('organization');
  const { theme: appTheme, setTheme: setAppTheme, resolvedTheme } = useTheme();

  // Preview calculations for Brand & Theme
  const resolvedBrand = React.useMemo(() => {
    const color = brandColor.trim() || '#047857';
    const theme = resolveBrandTheme(color);
    const contrast = contrastRatio(theme.light.accent, '#ffffff');
    const displayContrast = (Math.round(contrast * 10) / 10).toFixed(1);
    const onColor = readableForeground(theme.light.accent);
    return { color, theme, displayContrast, onColor };
  }, [brandColor]);

  const fieldError = (section: SectionKey, field: string): string | undefined => {
    return saves[section]?.fieldErrors?.[field];
  };

  interface SettingsCategoryItem {
    id?: SectionKey;
    label: string;
    icon: React.ElementType;
    note: string;
    href?: string;
    disabledBadge?: string;
    adminOnly?: boolean;
  }

  interface SettingsCategory {
    category: string;
    adminOnly?: boolean;
    items: SettingsCategoryItem[];
  }

  const settingsCategories: SettingsCategory[] = [
    {
      category: 'Account',
      items: [
        {
          id: 'profile',
          label: 'My Profile',
          icon: User,
          note: 'Personal credentials & avatar',
        },
        {
          label: 'Notifications',
          icon: Bell,
          note: 'Delivery alerts & preferences',
          href: '/automation/preferences',
        },
        {
          label: 'Security',
          icon: KeyRound,
          note: 'Password & sessions',
          disabledBadge: 'Coming Soon',
        },
      ],
    },
    {
      category: 'Appearance',
      items: [
        {
          id: 'appearance',
          label: 'Theme & Display',
          icon: Sun,
          note: 'Light, Dark, and System modes',
        },
      ],
    },
    {
      category: 'Workspace',
      items: [
        {
          id: 'organization',
          label: 'Organization Profile',
          icon: Building2,
          note: 'Company name & address',
        },
        {
          id: 'branding',
          label: 'Branding',
          icon: Palette,
          note: 'Logos, colors & brand name',
        },
        {
          id: 'currency',
          label: 'Currency & Dates',
          icon: CreditCard,
          note: 'Currency, dates & tax rules',
        },
        {
          id: 'invoice',
          label: 'Invoice Preferences',
          icon: FileText,
          note: 'Prefixes & sequences',
        },
        {
          id: 'proposal',
          label: 'Proposal Preferences',
          icon: Sparkles,
          note: 'Prefixes & validity',
        },
      ],
    },
    {
      category: 'Administration',
      adminOnly: true,
      items: [
        {
          label: 'Users & Invitations',
          icon: Users,
          note: 'Team access management',
          href: '/admin/users',
        },
        {
          label: 'Roles & Permissions',
          icon: Shield,
          note: 'RBAC & permission policies',
          href: '/admin/roles',
        },
        {
          label: 'Audit Log',
          icon: ScrollText,
          note: 'System activity logs',
          href: '/admin/audit-logs',
        },
        {
          label: 'Feature Flags',
          icon: Flag,
          note: 'Beta features & toggles',
          href: '/admin/feature-flags',
        },
      ],
    },
    {
      category: 'System',
      adminOnly: true,
      items: [
        {
          label: 'System Health',
          icon: Activity,
          note: 'Database & operational metrics',
          href: '/admin/health',
        },
        {
          label: 'Backup & Data',
          icon: Database,
          note: 'Snapshots & export',
          disabledBadge: 'Coming Soon',
        },
        {
          label: 'Integrations',
          icon: Sliders,
          note: 'External services & webhooks',
          disabledBadge: 'Coming Soon',
        },
      ],
    },
  ];

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Workspace</span>
            <span>/</span>
            <span>Preferences & Identity</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">
            Settings & Branding
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage organization identity, white-label branding, financial numbering sequences, and
            user profiles
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/users">Users & Roles</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/feature-flags">Feature Flags</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/health">System Health</Link>
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Organization Name',
            value: org.name || 'AgencyOS',
            note: org.domain ? org.domain : 'Custom domain unmapped',
          },
          {
            label: 'Base Currency',
            value: org.settings.defaultCurrency ?? 'USD',
            note: `Date format: ${org.settings.dateFormat ?? 'MM/DD/YYYY'}`,
          },
          {
            label: 'Next Invoice',
            value: org.nextNumbers.invoice.preview,
            note: `Sequence: #${org.nextNumbers.invoice.nextSequence}`,
            tone: 'ok',
          },
          {
            label: 'Role Status',
            value: org.isAdmin ? 'Administrator' : 'Standard Member',
            note: readOnly ? 'Read-only organization view' : 'Authorized for system configuration',
            tone: org.isAdmin ? 'ok' : undefined,
          },
        ]}
      />

      {readOnly && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-800 dark:text-amber-200 flex items-center gap-2">
          <Shield className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            Organization settings are view-only for non-administrators. You can review current
            configuration and edit your personal profile below.
          </span>
        </div>
      )}

      {/* ── Main Layout: Section Navigation & Bento Panel Content ─────── */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
        {/* Secondary Navigation Sidebar Organized by Categories */}
        <div className="lg:col-span-1 space-y-4">
          <Panel title="Settings Center">
            <div className="p-2 space-y-4">
              {settingsCategories
                .filter((group) => !group.adminOnly || org.isAdmin)
                .map((group) => (
                  <div key={group.category} className="space-y-1">
                    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {group.category}
                    </div>
                    <div className="space-y-0.5">
                      {group.items.map((item, idx) => {
                        const Icon = item.icon;
                        if (item.href) {
                          return (
                            <Link
                              key={idx}
                              href={item.href}
                              className="w-full text-left px-3 py-2 rounded-md text-xs font-medium transition-colors flex items-center justify-between text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <Icon className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{item.label}</span>
                              </div>
                              <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
                            </Link>
                          );
                        }

                        if (item.disabledBadge) {
                          return (
                            <div
                              key={idx}
                              className="w-full text-left px-3 py-2 rounded-md text-xs font-medium flex items-center justify-between text-muted-foreground/50 cursor-not-allowed select-none"
                              title={item.note}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <Icon className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{item.label}</span>
                              </div>
                              <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-muted text-muted-foreground/70">
                                {item.disabledBadge}
                              </span>
                            </div>
                          );
                        }

                        const isActive = activeSection === item.id;
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => item.id && setActiveSection(item.id)}
                            className={`w-full text-left px-3 py-2 rounded-md text-xs font-medium transition-colors flex items-start gap-2.5 ${
                              isActive
                                ? 'bg-accent text-accent-foreground font-semibold shadow-xs'
                                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                            }`}
                          >
                            <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              <div className="truncate">{item.label}</div>
                              <div
                                className={`text-[10px] truncate ${
                                  isActive
                                    ? 'text-accent-foreground/80'
                                    : 'text-muted-foreground/70'
                                }`}
                              >
                                {item.note}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
            </div>
          </Panel>
        </div>

        {/* Section Detail Form Panel */}
        <div className="lg:col-span-3 min-w-0">
          {/* 1. Organization Information */}
          {activeSection === 'organization' && (
            <Panel
              title="Organisation Profile"
              action={
                org.isAdmin ? (
                  <StatusPill tone="ok">Admin Authorized</StatusPill>
                ) : (
                  <StatusPill tone="neutral">Read Only</StatusPill>
                )
              }
            >
              <form onSubmit={onOrganizationSave} className="p-5 space-y-5">
                <div className="text-xs text-muted-foreground">
                  Registered legal organization name, regional address, and official communication
                  channels used across documents and emails.
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-xs font-medium" htmlFor="bento-org-name">
                      Organization Name <span className="text-destructive">*</span>
                    </label>
                    <input
                      id="bento-org-name"
                      type="text"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      disabled={readOnly}
                      className="w-full border border-input rounded-md px-3 py-2 text-xs bg-background disabled:opacity-60"
                      placeholder="e.g. Acme Agency Ltd."
                      maxLength={120}
                      required
                    />
                    {fieldError('organization', 'name') && (
                      <p className="text-[11px] text-destructive">
                        {fieldError('organization', 'name')}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="bento-contact-email">
                      Contact Email
                    </label>
                    <input
                      id="bento-contact-email"
                      type="email"
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                      disabled={readOnly}
                      className="w-full border border-input rounded-md px-3 py-2 text-xs bg-background disabled:opacity-60"
                      placeholder="billing@acme.com"
                    />
                    {fieldError('organization', 'contactEmail') && (
                      <p className="text-[11px] text-destructive">
                        {fieldError('organization', 'contactEmail')}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="bento-contact-phone">
                      Contact Phone
                    </label>
                    <input
                      id="bento-contact-phone"
                      type="tel"
                      value={contactPhone}
                      onChange={(e) => setContactPhone(e.target.value)}
                      disabled={readOnly}
                      className="w-full border border-input rounded-md px-3 py-2 text-xs bg-background disabled:opacity-60"
                      placeholder="+1 (555) 019-2834"
                      maxLength={50}
                    />
                  </div>

                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-xs font-medium" htmlFor="bento-address">
                      Street Address
                    </label>
                    <input
                      id="bento-address"
                      type="text"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      disabled={readOnly}
                      className="w-full border border-input rounded-md px-3 py-2 text-xs bg-background disabled:opacity-60"
                      placeholder="100 Innovation Way, Suite 400"
                      maxLength={200}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="bento-city">
                      City
                    </label>
                    <input
                      id="bento-city"
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      disabled={readOnly}
                      className="w-full border border-input rounded-md px-3 py-2 text-xs bg-background disabled:opacity-60"
                      placeholder="San Francisco"
                      maxLength={100}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="bento-postal">
                      Postal / ZIP Code
                    </label>
                    <input
                      id="bento-postal"
                      type="text"
                      value={postalCode}
                      onChange={(e) => setPostalCode(e.target.value)}
                      disabled={readOnly}
                      className="w-full border border-input rounded-md px-3 py-2 text-xs bg-background disabled:opacity-60"
                      placeholder="94105"
                      maxLength={20}
                    />
                  </div>

                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-xs font-medium" htmlFor="bento-country">
                      Country
                    </label>
                    <input
                      id="bento-country"
                      type="text"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      disabled={readOnly}
                      className="w-full border border-input rounded-md px-3 py-2 text-xs bg-background disabled:opacity-60"
                      placeholder="United States"
                      maxLength={100}
                    />
                  </div>
                </div>

                {!readOnly && (
                  <div className="pt-4 border-t border-border flex items-center justify-between">
                    <div className="text-xs text-muted-foreground">
                      {saves.organization.message && (
                        <span
                          className={
                            saves.organization.status === 'error'
                              ? 'text-destructive'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }
                        >
                          {saves.organization.message}
                        </span>
                      )}
                    </div>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={saves.organization.status === 'saving'}
                    >
                      <Save className="h-3.5 w-3.5 mr-1.5" />
                      {saves.organization.status === 'saving' ? 'Saving…' : 'Save Organization'}
                    </Button>
                  </div>
                )}
              </form>
            </Panel>
          )}

          {/* Appearance (Theme & Display) */}
          {activeSection === 'appearance' && (
            <Panel title="Theme & Display Preferences">
              <div className="p-5 space-y-6">
                <div className="space-y-3 pb-5">
                  <div>
                    <h4 className="text-xs font-semibold text-foreground">Interface Theme Mode</h4>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Choose your personal interface presentation mode. Selecting System
                      synchronizes with your operating system preferences.
                    </p>
                  </div>

                  <div
                    className="grid grid-cols-3 gap-3"
                    role="radiogroup"
                    aria-label="Appearance options"
                  >
                    <button
                      type="button"
                      onClick={() => setAppTheme('light')}
                      className={`p-3 rounded-lg border text-left flex flex-col gap-2 transition-all ${
                        appTheme === 'light'
                          ? 'border-accent ring-2 ring-accent/30 bg-accent/5'
                          : 'border-border hover:border-border/80 bg-background'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <Sun className="h-4 w-4 text-amber-500" />
                        {appTheme === 'light' && <Check className="h-3.5 w-3.5 text-accent" />}
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-foreground">Light</div>
                        <div className="text-[10px] text-muted-foreground">Crisp high contrast</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setAppTheme('dark')}
                      className={`p-3 rounded-lg border text-left flex flex-col gap-2 transition-all ${
                        appTheme === 'dark'
                          ? 'border-accent ring-2 ring-accent/30 bg-accent/5'
                          : 'border-border hover:border-border/80 bg-background'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <Moon className="h-4 w-4 text-indigo-400" />
                        {appTheme === 'dark' && <Check className="h-3.5 w-3.5 text-accent" />}
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-foreground">Dark</div>
                        <div className="text-[10px] text-muted-foreground">
                          Low-glare night palette
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setAppTheme('system')}
                      className={`p-3 rounded-lg border text-left flex flex-col gap-2 transition-all ${
                        appTheme === 'system'
                          ? 'border-accent ring-2 ring-accent/30 bg-accent/5'
                          : 'border-border hover:border-border/80 bg-background'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <Laptop className="h-4 w-4 text-muted-foreground" />
                        {appTheme === 'system' && <Check className="h-3.5 w-3.5 text-accent" />}
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-foreground">System</div>
                        <div className="text-[10px] text-muted-foreground">
                          Follows OS ({resolvedTheme})
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            </Panel>
          )}

          {/* 2. Branding (Workspace Identity) */}
          {activeSection === 'branding' && (
            <Panel
              title="Brand & Visual Identity"
              action={
                org.isAdmin ? (
                  <StatusPill tone="ok">Admin Authorized</StatusPill>
                ) : (
                  <StatusPill tone="neutral">Read Only</StatusPill>
                )
              }
            >
              <div className="p-5 space-y-6">
                <form onSubmit={onBrandingSave} className="space-y-6">
                  <div className="text-xs text-muted-foreground">
                    Configure white-label branding, logo artwork, and primary color palette. Accent
                    colors must provide compliant WCAG AA contrast (≥ 4.5:1) against white text.
                  </div>

                  {/* Swatch palette picker */}
                  <div className="space-y-2">
                    <label className="text-xs font-medium block">
                      Curated Accessible Palette Swatches
                    </label>
                    <div
                      className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2"
                      role="radiogroup"
                      aria-label="Brand accent color swatches"
                    >
                      {BRAND_SWATCHES.map((swatch) => {
                        const isSelected =
                          brandColor.trim().toLowerCase() === swatch.hex.toLowerCase();
                        return (
                          <button
                            key={swatch.hex}
                            type="button"
                            disabled={readOnly}
                            onClick={() => setBrandColor(swatch.hex)}
                            className={`p-2 rounded-lg border text-left flex flex-col gap-1.5 transition-all ${
                              isSelected
                                ? 'border-accent ring-2 ring-accent/30 bg-accent/5'
                                : 'border-border hover:border-border/80 bg-background'
                            }`}
                          >
                            <div
                              className="h-7 w-full rounded flex items-center justify-center font-bold text-xs"
                              style={{ backgroundColor: swatch.hex, color: swatch.on }}
                            >
                              {isSelected && <Check className="h-4 w-4" />}
                            </div>
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="font-medium text-foreground">{swatch.name}</span>
                              <span className="text-[10px] text-muted-foreground font-mono">
                                {swatch.ratio}:1
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Custom inputs */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium" htmlFor="bento-brand-name">
                        Customer-Facing Brand Name
                      </label>
                      <input
                        id="bento-brand-name"
                        type="text"
                        value={brandName}
                        onChange={(e) => setBrandName(e.target.value)}
                        disabled={readOnly}
                        className="w-full border border-input rounded-md px-3 py-2 text-xs bg-background disabled:opacity-60"
                        placeholder="Defaults to organization name"
                        maxLength={120}
                      />
                      <p className="text-[10px] text-muted-foreground">
                        Shown on printable PDFs, invoice headers, and client portals.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium" htmlFor="bento-brand-color">
                        Custom Brand Hex Color
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={resolvedBrand.color}
                          onChange={(e) => setBrandColor(e.target.value)}
                          disabled={readOnly}
                          className="h-8 w-10 p-0.5 rounded border border-input cursor-pointer disabled:opacity-60"
                        />
                        <input
                          id="bento-brand-color"
                          type="text"
                          value={brandColor}
                          onChange={(e) => setBrandColor(e.target.value)}
                          disabled={readOnly}
                          className="flex-1 border border-input rounded-md px-3 py-2 text-xs font-mono bg-background disabled:opacity-60"
                          placeholder="#047857"
                          maxLength={7}
                        />
                      </div>
                      {fieldError('branding', 'brandColor') ? (
                        <p className="text-[11px] text-destructive">
                          {fieldError('branding', 'brandColor')}
                        </p>
                      ) : (
                        <p className="text-[10px] text-muted-foreground">
                          WCAG AA Contrast: {resolvedBrand.displayContrast}:1
                        </p>
                      )}
                    </div>

                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-xs font-medium" htmlFor="bento-logo-url">
                        Logo Artwork Absolute URL
                      </label>
                      <input
                        id="bento-logo-url"
                        type="url"
                        value={logoUrl}
                        onChange={(e) => setLogoUrl(e.target.value)}
                        disabled={readOnly}
                        className="w-full border border-input rounded-md px-3 py-2 text-xs bg-background disabled:opacity-60"
                        placeholder="https://cdn.youragency.com/logo.png"
                        maxLength={500}
                      />
                      {fieldError('branding', 'logoUrl') && (
                        <p className="text-[11px] text-destructive">
                          {fieldError('branding', 'logoUrl')}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Live Client Preview Bento Tile */}
                  <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Live Client Portal Preview
                    </div>
                    <div className="rounded-md border border-border bg-background overflow-hidden shadow-xs">
                      <div
                        className="px-4 py-3 flex items-center justify-between"
                        style={{
                          backgroundColor: resolvedBrand.theme.light.accent,
                          color: resolvedBrand.onColor,
                        }}
                      >
                        <div className="flex items-center gap-2">
                          {logoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={logoUrl}
                              alt="Logo preview"
                              className="h-6 max-w-[120px] object-contain rounded"
                            />
                          ) : (
                            <div
                              className="h-6 w-6 rounded flex items-center justify-center font-bold text-xs"
                              style={{
                                backgroundColor: 'rgba(255,255,255,0.2)',
                                color: resolvedBrand.onColor,
                              }}
                            >
                              {(brandName || orgName || 'A').slice(0, 1).toUpperCase()}
                            </div>
                          )}
                          <span className="font-semibold text-sm">
                            {brandName || orgName || 'AgencyOS Studio'}
                          </span>
                        </div>
                        <span className="text-[11px] px-2 py-0.5 rounded bg-black/20 font-mono">
                          Portal #402
                        </span>
                      </div>
                      <div className="p-4 space-y-2 text-xs text-muted-foreground">
                        <div className="font-medium text-foreground">
                          Document Preview: Shared Invoice & Proposal Portal
                        </div>
                        <p>
                          This sample represents how customers and prospective clients will see
                          shared contracts, statements of work, and billing documents.
                        </p>
                      </div>
                    </div>
                  </div>

                  {!readOnly && (
                    <div className="pt-4 border-t border-border flex items-center justify-between">
                      <div className="text-xs text-muted-foreground">
                        {saves.branding.message && (
                          <span
                            className={
                              saves.branding.status === 'error'
                                ? 'text-destructive'
                                : 'text-emerald-600 dark:text-emerald-400'
                            }
                          >
                            {saves.branding.message}
                          </span>
                        )}
                      </div>
                      <Button type="submit" size="sm" disabled={saves.branding.status === 'saving'}>
                        <Save className="h-3.5 w-3.5 mr-1.5" />
                        {saves.branding.status === 'saving' ? 'Saving…' : 'Save Brand Settings'}
                      </Button>
                    </div>
                  )}
                </form>
              </div>
            </Panel>
          )}

          {/* 3. Currency & Financial Defaults */}
          {activeSection === 'currency' && (
            <Panel
              title="Currency & Regional Defaults"
              action={
                org.isAdmin ? (
                  <StatusPill tone="ok">Admin Authorized</StatusPill>
                ) : (
                  <StatusPill tone="neutral">Read Only</StatusPill>
                )
              }
            >
              <form onSubmit={onCurrencySave} className="p-5 space-y-5">
                <div className="text-xs text-muted-foreground">
                  Set baseline financial currency and date rendering format for project estimations,
                  quotations, and accounting statements.
                </div>

                <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-800 dark:text-blue-200 flex items-start gap-2">
                  <Shield className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400 mt-0.5" />
                  <span>
                    <strong>Currency &amp; Historical Expense Policy:</strong> Invoices, estimates,
                    and expenses permanently persist their individual transaction currency. Changing
                    the workspace default currency sets the preselected currency for newly created
                    records and does not alter existing, verified historical expense currencies.
                    Unresolved legacy expenses require explicit administrative reconciliation.
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="bento-default-currency">
                      Default Currency
                    </label>
                    <Combobox
                      options={currencyOptions}
                      value={defaultCurrency}
                      onChange={setDefaultCurrency}
                      placeholder="Select currency"
                      searchPlaceholder="Search currency code or name"
                      emptyMessage="No supported currency found."
                      disabled={readOnly}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Base currency code applied to newly generated financial documents.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="bento-date-format">
                      Display Date Format
                    </label>
                    <select
                      id="bento-date-format"
                      value={dateFormat}
                      onChange={(e) => setDateFormat(e.target.value)}
                      disabled={readOnly}
                      className="w-full border border-input rounded-md px-3 py-2 text-xs bg-background disabled:opacity-60"
                    >
                      {dateFormats.map((df) => (
                        <option key={df.value} value={df.value}>
                          {df.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-muted-foreground">
                      Standard date formatting used across activity feeds and tables.
                    </p>
                  </div>

                  {defaultCurrency !== (org.settings.defaultCurrency ?? 'USD') && (
                    <div className="md:col-span-2 pt-1">
                      <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
                        <input
                          type="checkbox"
                          checked={confirmCurrencyChange}
                          onChange={(e) => setConfirmCurrencyChange?.(e.target.checked)}
                          disabled={readOnly}
                          className="mt-0.5 rounded border-input"
                        />
                        <span>
                          I confirm changing the workspace default currency from{' '}
                          <strong>{org.settings.defaultCurrency ?? 'USD'}</strong> to{' '}
                          <strong>{defaultCurrency}</strong>. Existing expenses and invoices retain
                          their original persisted currencies without foreign exchange conversion.
                        </span>
                      </label>
                    </div>
                  )}
                </div>

                {!readOnly && (
                  <div className="pt-4 border-t border-border flex items-center justify-between">
                    <div className="text-xs text-muted-foreground">
                      {saves.currency.message && (
                        <span
                          className={
                            saves.currency.status === 'error'
                              ? 'text-destructive'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }
                        >
                          {saves.currency.message}
                        </span>
                      )}
                    </div>
                    <Button type="submit" size="sm" disabled={saves.currency.status === 'saving'}>
                      <Save className="h-3.5 w-3.5 mr-1.5" />
                      {saves.currency.status === 'saving' ? 'Saving…' : 'Save Defaults'}
                    </Button>
                  </div>
                )}
              </form>
            </Panel>
          )}

          {/* 4. Invoice Preferences */}
          {activeSection === 'invoice' && (
            <Panel
              title="Invoice Numbering & Tax Rules"
              action={
                org.isAdmin ? (
                  <StatusPill tone="ok">Admin Authorized</StatusPill>
                ) : (
                  <StatusPill tone="neutral">Read Only</StatusPill>
                )
              }
            >
              <form onSubmit={onInvoiceSave} className="p-5 space-y-5">
                <div className="text-xs text-muted-foreground">
                  Sequential numbering formats and default tax rates for customer billing documents.
                  Counter values are monotonic and cannot be decremented below issued ledger
                  sequences.
                </div>

                <div className="rounded-md border border-accent/20 bg-accent/5 p-3 flex items-center justify-between">
                  <div className="text-xs">
                    <span className="font-semibold text-foreground">Next Assigned Invoice: </span>
                    <span className="font-mono text-accent font-bold">
                      {org.nextNumbers.invoice.preview}
                    </span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    Next Sequence #{org.nextNumbers.invoice.nextSequence}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="bento-inv-prefix">
                      Invoice Prefix
                    </label>
                    <input
                      id="bento-inv-prefix"
                      type="text"
                      value={invoicePrefix}
                      onChange={(e) => setInvoicePrefix(e.target.value.toUpperCase())}
                      disabled={readOnly}
                      className="w-full border border-input rounded-md px-3 py-2 text-xs font-mono bg-background disabled:opacity-60"
                      placeholder="INV"
                      maxLength={12}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Capital letters, numbers, and dashes.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="bento-inv-next">
                      Next Sequence Counter
                    </label>
                    <input
                      id="bento-inv-next"
                      type="number"
                      value={invoiceNextNumber}
                      onChange={(e) => setInvoiceNextNumber(e.target.value)}
                      disabled={readOnly}
                      className="w-full border border-input rounded-md px-3 py-2 text-xs font-mono bg-background disabled:opacity-60"
                      placeholder={String(org.nextNumbers.invoice.nextSequence)}
                      min={1}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Must be higher than existing ledger.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="bento-inv-tax">
                      Default Tax Rate (%)
                    </label>
                    <input
                      id="bento-inv-tax"
                      type="number"
                      value={invoiceTaxDefault}
                      onChange={(e) => setInvoiceTaxDefault(e.target.value)}
                      disabled={readOnly}
                      className="w-full border border-input rounded-md px-3 py-2 text-xs bg-background disabled:opacity-60"
                      placeholder="0"
                      min={0}
                      max={100}
                      step="0.01"
                    />
                    <p className="text-[10px] text-muted-foreground">Applied to new line items.</p>
                  </div>
                </div>

                {!readOnly && (
                  <div className="pt-4 border-t border-border flex items-center justify-between">
                    <div className="text-xs text-muted-foreground">
                      {saves.invoice.message && (
                        <span
                          className={
                            saves.invoice.status === 'error'
                              ? 'text-destructive'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }
                        >
                          {saves.invoice.message}
                        </span>
                      )}
                    </div>
                    <Button type="submit" size="sm" disabled={saves.invoice.status === 'saving'}>
                      <Save className="h-3.5 w-3.5 mr-1.5" />
                      {saves.invoice.status === 'saving' ? 'Saving…' : 'Save Invoice Preferences'}
                    </Button>
                  </div>
                )}
              </form>
            </Panel>
          )}

          {/* 5. Proposal Preferences */}
          {activeSection === 'proposal' && (
            <Panel
              title="Proposal Numbering & Validity"
              action={
                org.isAdmin ? (
                  <StatusPill tone="ok">Admin Authorized</StatusPill>
                ) : (
                  <StatusPill tone="neutral">Read Only</StatusPill>
                )
              }
            >
              <form onSubmit={onProposalSave} className="p-5 space-y-5">
                <div className="text-xs text-muted-foreground">
                  Document numbering prefix, counter sequencing, and expiration windows for sales
                  proposals and quotations.
                </div>

                <div className="rounded-md border border-accent/20 bg-accent/5 p-3 flex items-center justify-between">
                  <div className="text-xs">
                    <span className="font-semibold text-foreground">Next Assigned Proposal: </span>
                    <span className="font-mono text-accent font-bold">
                      {org.nextNumbers.proposal.preview}
                    </span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    Next Sequence #{org.nextNumbers.proposal.nextSequence}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="bento-prp-prefix">
                      Proposal Prefix
                    </label>
                    <input
                      id="bento-prp-prefix"
                      type="text"
                      value={proposalPrefix}
                      onChange={(e) => setProposalPrefix(e.target.value.toUpperCase())}
                      disabled={readOnly}
                      className="w-full border border-input rounded-md px-3 py-2 text-xs font-mono bg-background disabled:opacity-60"
                      placeholder="PRP"
                      maxLength={12}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Capital letters, numbers, and dashes.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="bento-prp-next">
                      Next Sequence Counter
                    </label>
                    <input
                      id="bento-prp-next"
                      type="number"
                      value={proposalNextNumber}
                      onChange={(e) => setProposalNextNumber(e.target.value)}
                      disabled={readOnly}
                      className="w-full border border-input rounded-md px-3 py-2 text-xs font-mono bg-background disabled:opacity-60"
                      placeholder={String(org.nextNumbers.proposal.nextSequence)}
                      min={1}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Must be higher than existing ledger.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="bento-prp-valid">
                      Validity Window (Days)
                    </label>
                    <input
                      id="bento-prp-valid"
                      type="number"
                      value={proposalValidDays}
                      onChange={(e) => setProposalValidDays(e.target.value)}
                      disabled={readOnly}
                      className="w-full border border-input rounded-md px-3 py-2 text-xs bg-background disabled:opacity-60"
                      placeholder="30"
                      min={1}
                      max={365}
                    />
                    <p className="text-[10px] text-muted-foreground">Days until offer expires.</p>
                  </div>
                </div>

                {!readOnly && (
                  <div className="pt-4 border-t border-border flex items-center justify-between">
                    <div className="text-xs text-muted-foreground">
                      {saves.proposal.message && (
                        <span
                          className={
                            saves.proposal.status === 'error'
                              ? 'text-destructive'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }
                        >
                          {saves.proposal.message}
                        </span>
                      )}
                    </div>
                    <Button type="submit" size="sm" disabled={saves.proposal.status === 'saving'}>
                      <Save className="h-3.5 w-3.5 mr-1.5" />
                      {saves.proposal.status === 'saving' ? 'Saving…' : 'Save Proposal Preferences'}
                    </Button>
                  </div>
                )}
              </form>
            </Panel>
          )}

          {/* 6. User Profile */}
          {activeSection === 'profile' && (
            <Panel
              title="Personal User Profile"
              action={<StatusPill tone="ok">Self Editable</StatusPill>}
            >
              <form onSubmit={onProfileSave} className="p-5 space-y-5">
                <div className="text-xs text-muted-foreground">
                  Update your display name and avatar image. Your email and organization membership
                  are managed by workspace administrators.
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="bento-profile-email">
                      Email Address
                    </label>
                    <input
                      id="bento-profile-email"
                      type="email"
                      value={user.email}
                      disabled
                      className="w-full border border-input rounded-md px-3 py-2 text-xs bg-muted/50 text-muted-foreground cursor-not-allowed"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Managed via workspace invitations.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="bento-profile-role">
                      Assigned System Role
                    </label>
                    <input
                      id="bento-profile-role"
                      type="text"
                      value={user.role}
                      disabled
                      className="w-full border border-input rounded-md px-3 py-2 text-xs bg-muted/50 text-muted-foreground cursor-not-allowed"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="bento-profile-name">
                      Display Name
                    </label>
                    <input
                      id="bento-profile-name"
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full border border-input rounded-md px-3 py-2 text-xs bg-background"
                      placeholder="Jane Doe"
                      maxLength={100}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="bento-avatar-url">
                      Avatar Artwork URL
                    </label>
                    <input
                      id="bento-avatar-url"
                      type="url"
                      value={avatarUrl}
                      onChange={(e) => setAvatarUrl(e.target.value)}
                      className="w-full border border-input rounded-md px-3 py-2 text-xs bg-background"
                      placeholder="https://..."
                      maxLength={500}
                    />
                  </div>
                </div>

                <div className="pt-4 border-t border-border flex items-center justify-between">
                  <div className="text-xs text-muted-foreground">
                    {saves.profile.message && (
                      <span
                        className={
                          saves.profile.status === 'error'
                            ? 'text-destructive'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }
                      >
                        {saves.profile.message}
                      </span>
                    )}
                  </div>
                  <Button type="submit" size="sm" disabled={saves.profile.status === 'saving'}>
                    <Save className="h-3.5 w-3.5 mr-1.5" />
                    {saves.profile.status === 'saving' ? 'Saving…' : 'Save Personal Profile'}
                  </Button>
                </div>
              </form>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
