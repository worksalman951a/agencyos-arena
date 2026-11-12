/**
 * AgencyOS Settings page.
 *
 * Six sections, each saved independently against the same validated API:
 *
 *  1. Organization Information   — name and contact details
 *  2. Branding and Appearance    — brand name, colour, logo
 *  3. Currency and Financial Defaults — default currency, date format
 *  4. Invoice Preferences        — prefix, next number, default tax
 *  5. Proposal Preferences       — prefix, next number, validity
 *  6. User Profile               — display name, avatar (always editable)
 *
 * Organization sections are read-only for non-administrators — the server
 * rejects those writes regardless, this only avoids offering a doomed action.
 *
 * Clearing: optional inputs are sent as an empty string, which the server
 * normalizes to "delete this key" (previously `value || undefined` made a field
 * impossible to empty). Server field errors are shown under the offending input.
 *
 * Bifurcated under useBentoShell() with 100% legacy UI fallback.
 */

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { listCurrencies, DEFAULT_CURRENCY } from '@/lib/currencies';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import {
  BentoSettingsView,
  type OrganizationResponse,
  type UserProfileResponse,
  type SectionKey,
  type SaveState,
} from '@/components/settings/bento-settings-view';

const EMPTY_SAVE: SaveState = { status: 'idle' };

const DATE_FORMAT_OPTIONS = [
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (US)' },
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY (International)' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (ISO)' },
];

function SectionCard({
  id,
  title,
  description,
  badge,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-24 rounded-lg border border-border bg-background p-4 sm:p-6"
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {badge}
      </div>
      {description && <p className="mb-4 text-sm text-muted-foreground">{description}</p>}
      {children}
    </section>
  );
}

function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function StatusMessage({ state }: { state: SaveState }) {
  if (!state.message) return null;
  return (
    <p
      role="status"
      className={`text-sm ${state.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
    >
      {state.message}
    </p>
  );
}

function SaveRow({
  state,
  disabled,
  label,
}: {
  state: SaveState;
  disabled: boolean;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
      <StatusMessage state={state} />
      <button
        type="submit"
        disabled={disabled || state.status === 'saving'}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
      >
        {state.status === 'saving' ? 'Saving…' : label}
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const isBento = useBentoShell();
  const router = useRouter();

  const [org, setOrg] = useState<OrganizationResponse | null>(null);
  const [user, setUser] = useState<UserProfileResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saves, setSaves] = useState<Record<SectionKey, SaveState>>({
    organization: EMPTY_SAVE,
    branding: EMPTY_SAVE,
    currency: EMPTY_SAVE,
    invoice: EMPTY_SAVE,
    proposal: EMPTY_SAVE,
    profile: EMPTY_SAVE,
  });

  // Organization information
  const [orgName, setOrgName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [postalCode, setPostalCode] = useState('');

  // Branding
  const [brandName, setBrandName] = useState('');
  const [brandColor, setBrandColor] = useState('');
  const [logoUrl, setLogoUrl] = useState('');

  // Financial defaults
  const [defaultCurrency, setDefaultCurrency] = useState(DEFAULT_CURRENCY);
  const [dateFormat, setDateFormat] = useState('MM/DD/YYYY');

  // Invoice preferences
  const [invoicePrefix, setInvoicePrefix] = useState('');
  const [invoiceNextNumber, setInvoiceNextNumber] = useState('');
  const [invoiceTaxDefault, setInvoiceTaxDefault] = useState('');

  // Proposal preferences
  const [proposalPrefix, setProposalPrefix] = useState('');
  const [proposalNextNumber, setProposalNextNumber] = useState('');
  const [proposalValidDays, setProposalValidDays] = useState('');

  // Profile
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');

  const applyOrganization = useCallback((data: OrganizationResponse) => {
    setOrg(data);
    const s = data.settings;

    setOrgName(data.name);
    setContactEmail(s.contactEmail ?? '');
    setContactPhone(s.contactPhone ?? '');
    setAddress(s.address ?? '');
    setCity(s.city ?? '');
    setCountry(s.country ?? '');
    setPostalCode(s.postalCode ?? '');

    setBrandName(s.brandName ?? '');
    setBrandColor(s.brandColor ?? '');
    setLogoUrl(s.logoUrl ?? '');

    setDefaultCurrency(s.defaultCurrency ?? DEFAULT_CURRENCY);
    setDateFormat(s.dateFormat ?? 'MM/DD/YYYY');

    setInvoicePrefix(s.invoiceNumberPrefix ?? '');
    setInvoiceNextNumber(s.invoiceNextNumber?.toString() ?? '');
    setInvoiceTaxDefault(s.invoiceTaxDefault?.toString() ?? '');

    setProposalPrefix(s.proposalNumberPrefix ?? '');
    setProposalNextNumber(s.proposalNextNumber?.toString() ?? '');
    setProposalValidDays(s.proposalValidDays?.toString() ?? '');
  }, []);

  const applyUser = useCallback((data: UserProfileResponse) => {
    setUser(data);
    setDisplayName(data.name ?? '');
    setAvatarUrl(data.image ?? '');
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [orgRes, userRes] = await Promise.all([
          fetch('/api/v1/settings/organization'),
          fetch('/api/v1/settings/user'),
        ]);

        if (cancelled) return;

        if (!orgRes.ok || !userRes.ok) {
          const failing = !orgRes.ok ? orgRes : userRes;
          const body = (await failing.json().catch(() => ({}))) as { error?: string };
          throw new Error(
            body.error ??
              (failing.status === 403
                ? 'You do not have permission to view these settings.'
                : `Could not load settings (${failing.status}).`)
          );
        }

        applyOrganization((await orgRes.json()) as OrganizationResponse);
        applyUser((await userRes.json()) as UserProfileResponse);
        setLoadError(null);
      } catch (err) {
        if (!cancelled) setLoadError((err as Error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyOrganization, applyUser]);

  const setSave = useCallback((section: SectionKey, state: SaveState) => {
    setSaves((current) => ({ ...current, [section]: state }));
  }, []);

  const saveOrganizationSection = useCallback(
    async (
      section: SectionKey,
      payload: { name?: string; settings: Record<string, unknown> },
      successMessage: string,
      options?: { refreshShell?: boolean }
    ) => {
      setSave(section, { status: 'saving' });

      try {
        const res = await fetch('/api/v1/settings/organization', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          fieldErrors?: Record<string, string>;
        };

        if (!res.ok) {
          setSave(section, {
            status: 'error',
            message: body.error ?? `Could not save (${res.status}).`,
            fieldErrors: body.fieldErrors,
          });
          return;
        }

        applyOrganization(body as unknown as OrganizationResponse);
        setSave(section, { status: 'success', message: successMessage });
        toast.success(successMessage);

        if (options?.refreshShell) router.refresh();
      } catch (err) {
        setSave(section, { status: 'error', message: (err as Error).message });
      }
    },
    [applyOrganization, router, setSave]
  );

  const handleOrganizationSave = (event: React.FormEvent) => {
    event.preventDefault();
    void saveOrganizationSection(
      'organization',
      {
        name: orgName,
        settings: {
          contactEmail,
          contactPhone,
          address,
          city,
          country,
          postalCode,
        },
      },
      'Organization information saved.'
    );
  };

  const handleBrandingSave = (event: React.FormEvent) => {
    event.preventDefault();
    void saveOrganizationSection(
      'branding',
      { settings: { brandName, brandColor, logoUrl } },
      'Branding saved.',
      { refreshShell: true }
    );
  };

  const [confirmCurrencyChange, setConfirmCurrencyChange] = useState(false);

  const handleCurrencySave = (event: React.FormEvent) => {
    event.preventDefault();
    const currentStored = org?.settings.defaultCurrency ?? DEFAULT_CURRENCY;
    if (defaultCurrency !== currentStored && !confirmCurrencyChange) {
      setSave('currency', {
        status: 'error',
        message:
          'Please acknowledge that changing the workspace default currency will affect future documents and unassigned items. Check the confirmation box below to proceed.',
      });
      return;
    }

    void saveOrganizationSection(
      'currency',
      { settings: { defaultCurrency, dateFormat } },
      'Currency and financial defaults saved.'
    );
  };

  const buildInvoiceSettings = (): Record<string, unknown> => {
    const settings: Record<string, unknown> = { invoiceNumberPrefix: invoicePrefix };
    if (invoiceNextNumber !== '') settings.invoiceNextNumber = Number(invoiceNextNumber);
    if (invoiceTaxDefault !== '') settings.invoiceTaxDefault = Number(invoiceTaxDefault);
    return settings;
  };

  const buildProposalSettings = (): Record<string, unknown> => {
    const settings: Record<string, unknown> = { proposalNumberPrefix: proposalPrefix };
    if (proposalNextNumber !== '') settings.proposalNextNumber = Number(proposalNextNumber);
    if (proposalValidDays !== '') settings.proposalValidDays = Number(proposalValidDays);
    return settings;
  };

  const handleInvoiceSave = (event: React.FormEvent) => {
    event.preventDefault();
    void saveOrganizationSection(
      'invoice',
      { settings: buildInvoiceSettings() },
      'Invoice preferences saved.'
    );
  };

  const handleProposalSave = (event: React.FormEvent) => {
    event.preventDefault();
    void saveOrganizationSection(
      'proposal',
      { settings: buildProposalSettings() },
      'Proposal preferences saved.'
    );
  };

  const handleProfileSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setSave('profile', { status: 'saving' });

    try {
      const res = await fetch('/api/v1/settings/user', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, avatarUrl }),
      });

      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        fieldErrors?: Record<string, string>;
      };

      if (!res.ok) {
        setSave('profile', {
          status: 'error',
          message: body.error ?? `Could not save profile (${res.status}).`,
          fieldErrors: body.fieldErrors,
        });
        return;
      }

      applyUser(body as unknown as UserProfileResponse);
      setSave('profile', { status: 'success', message: 'Profile saved.' });
      toast.success('Profile saved.');
      router.refresh();
    } catch (err) {
      setSave('profile', { status: 'error', message: (err as Error).message });
    }
  };

  const currencyOptions: ComboboxOption[] = useMemo(
    () =>
      listCurrencies().map((currency) => ({
        value: currency.code,
        label: `${currency.code} — ${currency.name}`,
        keywords: `${currency.code} ${currency.name} ${currency.symbol}`,
      })),
    []
  );

  const readOnly = org ? !org.isAdmin : true;

  const fieldError = (section: SectionKey, field: string): string | undefined => {
    return saves[section].fieldErrors?.[field];
  };

  const inputClass = (section: SectionKey, field: string): string => {
    const hasError = Boolean(fieldError(section, field));
    return `w-full rounded-md border px-3 py-2 text-sm bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60 disabled:cursor-not-allowed ${
      hasError ? 'border-destructive focus:ring-destructive' : 'border-input'
    }`;
  };

  if (loadError) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4">
          <h3 className="mb-1 text-sm font-semibold text-destructive">Failed to load settings</h3>
          <p className="text-sm text-destructive">{loadError}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-3 text-sm font-medium text-destructive underline"
          >
            Refresh page
          </button>
        </div>
      </div>
    );
  }

  if (!org || !user) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-accent" />
          Loading settings…
        </div>
      </div>
    );
  }

  // ── Bento Modern Presentation Shell ──────────────────────────────────────────
  if (isBento) {
    return (
      <BentoSettingsView
        org={org}
        user={user}
        saves={saves}
        readOnly={readOnly}
        orgName={orgName}
        setOrgName={setOrgName}
        contactEmail={contactEmail}
        setContactEmail={setContactEmail}
        contactPhone={contactPhone}
        setContactPhone={setContactPhone}
        address={address}
        setAddress={setAddress}
        city={city}
        setCity={setCity}
        country={country}
        setCountry={setCountry}
        postalCode={postalCode}
        setPostalCode={setPostalCode}
        brandName={brandName}
        setBrandName={setBrandName}
        brandColor={brandColor}
        setBrandColor={setBrandColor}
        logoUrl={logoUrl}
        setLogoUrl={setLogoUrl}
        defaultCurrency={defaultCurrency}
        setDefaultCurrency={setDefaultCurrency}
        dateFormat={dateFormat}
        setDateFormat={setDateFormat}
        currencyOptions={currencyOptions}
        dateFormats={DATE_FORMAT_OPTIONS}
        invoicePrefix={invoicePrefix}
        setInvoicePrefix={setInvoicePrefix}
        invoiceNextNumber={invoiceNextNumber}
        setInvoiceNextNumber={setInvoiceNextNumber}
        invoiceTaxDefault={invoiceTaxDefault}
        setInvoiceTaxDefault={setInvoiceTaxDefault}
        proposalPrefix={proposalPrefix}
        setProposalPrefix={setProposalPrefix}
        proposalNextNumber={proposalNextNumber}
        setProposalNextNumber={setProposalNextNumber}
        proposalValidDays={proposalValidDays}
        setProposalValidDays={setProposalValidDays}
        displayName={displayName}
        setDisplayName={setDisplayName}
        avatarUrl={avatarUrl}
        setAvatarUrl={setAvatarUrl}
        confirmCurrencyChange={confirmCurrencyChange}
        setConfirmCurrencyChange={setConfirmCurrencyChange}
        onOrganizationSave={handleOrganizationSave}
        onBrandingSave={handleBrandingSave}
        onCurrencySave={handleCurrencySave}
        onInvoiceSave={handleInvoiceSave}
        onProposalSave={handleProposalSave}
        onProfileSave={handleProfileSave}
      />
    );
  }

  // ── Legacy Functional Fallback ─────────────────────────────────────────────
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground">
            Organization branding, financial defaults and your own profile.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="rounded-md bg-muted px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/80"
        >
          Back to Dashboard
        </Link>
      </div>

      <nav aria-label="Settings sections" className="-mx-1 overflow-x-auto">
        <ul className="flex min-w-max gap-1 px-1">
          {[
            ['organization', 'Organization Information'],
            ['branding', 'Branding and Appearance'],
            ['currency', 'Currency and Financial Defaults'],
            ['invoice', 'Invoice Preferences'],
            ['proposal', 'Proposal Preferences'],
            ['profile', 'User Profile'],
          ].map(([id, label]) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className="block rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {readOnly && (
        <p className="rounded-md border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200">
          Organization settings are read-only for your role. You can still update your own profile.
        </p>
      )}

      {/* 1. Organization Information */}
      <SectionCard
        id="organization"
        title="Organization Information"
        description="Legal/registered name and contact details used across the workspace."
      >
        <form onSubmit={handleOrganizationSave} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field
              label="Organization name"
              htmlFor="org-name"
              error={fieldError('organization', 'name')}
              hint="Shown in the app and used as the brand name when none is set."
            >
              <input
                id="org-name"
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                disabled={readOnly}
                className={inputClass('organization', 'name')}
                placeholder="Your agency name"
                maxLength={120}
              />
            </Field>

            <Field
              label="Contact email"
              htmlFor="org-email"
              error={fieldError('organization', 'contactEmail')}
            >
              <input
                id="org-email"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                disabled={readOnly}
                className={inputClass('organization', 'contactEmail')}
                placeholder="hello@agency.com"
              />
            </Field>

            <Field
              label="Contact phone"
              htmlFor="org-phone"
              error={fieldError('organization', 'contactPhone')}
            >
              <input
                id="org-phone"
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                disabled={readOnly}
                className={inputClass('organization', 'contactPhone')}
                placeholder="+1 (555) 012-3456"
                maxLength={50}
              />
            </Field>

            <Field
              label="Street address"
              htmlFor="org-address"
              error={fieldError('organization', 'address')}
            >
              <input
                id="org-address"
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                disabled={readOnly}
                className={inputClass('organization', 'address')}
                placeholder="123 Agency Street, Suite 400"
                maxLength={200}
              />
            </Field>

            <Field label="City" htmlFor="org-city" error={fieldError('organization', 'city')}>
              <input
                id="org-city"
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                disabled={readOnly}
                className={inputClass('organization', 'city')}
                placeholder="San Francisco"
                maxLength={100}
              />
            </Field>

            <Field
              label="Postal code"
              htmlFor="org-postal"
              error={fieldError('organization', 'postalCode')}
            >
              <input
                id="org-postal"
                type="text"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                disabled={readOnly}
                className={inputClass('organization', 'postalCode')}
                placeholder="94105"
                maxLength={20}
              />
            </Field>

            <Field
              label="Country"
              htmlFor="org-country"
              error={fieldError('organization', 'country')}
            >
              <input
                id="org-country"
                type="text"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                disabled={readOnly}
                className={inputClass('organization', 'country')}
                placeholder="United States"
                maxLength={100}
              />
            </Field>
          </div>

          <SaveRow
            state={saves.organization}
            disabled={readOnly}
            label="Save Organization Information"
          />
        </form>
      </SectionCard>

      {/* 2. Branding and Appearance */}
      <SectionCard
        id="branding"
        title="Branding and Appearance"
        description="Brand identity used on customer-facing documents (invoices, proposals)."
      >
        <form onSubmit={handleBrandingSave} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field
              label="Brand name"
              htmlFor="brand-name"
              error={fieldError('branding', 'brandName')}
              hint="Overrides the organization name on customer deliverables when set."
            >
              <input
                id="brand-name"
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                disabled={readOnly}
                className={inputClass('branding', 'brandName')}
                placeholder="Defaults to organization name"
                maxLength={120}
              />
            </Field>

            <Field
              label="Brand colour"
              htmlFor="brand-color"
              error={fieldError('branding', 'brandColor')}
              hint="Hex colour code, e.g. #047857. Must have ≥ 4.5:1 contrast against white."
            >
              <div className="flex gap-2">
                <input
                  type="color"
                  value={brandColor || '#047857'}
                  onChange={(e) => setBrandColor(e.target.value)}
                  disabled={readOnly}
                  className="h-9 w-12 rounded border border-input p-0.5 disabled:opacity-60"
                  aria-label="Pick brand colour"
                />
                <input
                  id="brand-color"
                  type="text"
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  disabled={readOnly}
                  className={`${inputClass('branding', 'brandColor')} font-mono`}
                  placeholder="#047857"
                  maxLength={7}
                />
              </div>
            </Field>

            <div className="md:col-span-2">
              <Field
                label="Logo URL"
                htmlFor="brand-logo"
                error={fieldError('branding', 'logoUrl')}
                hint="Absolute http(s) URL to an image. Hosted by your own CDN or file store."
              >
                <input
                  id="brand-logo"
                  type="url"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  disabled={readOnly}
                  className={inputClass('branding', 'logoUrl')}
                  placeholder="https://cdn.example.com/logo.png"
                  maxLength={500}
                />
              </Field>
            </div>
          </div>

          <SaveRow
            state={saves.branding}
            disabled={readOnly}
            label="Save Branding and Appearance"
          />
        </form>
      </SectionCard>

      {/* 3. Currency and Financial Defaults */}
      <SectionCard
        id="currency"
        title="Currency and Financial Defaults"
        description="Defaults applied to new documents across the organization."
      >
        <form onSubmit={handleCurrencySave} className="space-y-4">
          <p className="rounded-md border border-blue-300/60 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-500/40 dark:bg-blue-950/40 dark:text-blue-200">
            <strong>Currency &amp; Historical Expense Policy:</strong> Invoices, estimates, and
            expenses permanently persist their individual transaction currency. Changing the
            workspace default currency sets the preselected currency for newly created records and
            does not alter existing, verified historical expense currencies. Unresolved legacy
            expenses require explicit administrative reconciliation.
          </p>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field
              label="Default currency"
              error={fieldError('currency', 'defaultCurrency')}
              hint="Preselected when creating invoices, proposals and project budgets."
            >
              <Combobox
                options={currencyOptions}
                value={defaultCurrency}
                onChange={setDefaultCurrency}
                placeholder="Select currency"
                searchPlaceholder="Search currency code or name"
                emptyMessage="No supported currency found."
                disabled={readOnly}
              />
            </Field>

            <Field
              label="Date format"
              htmlFor="date-format"
              error={fieldError('currency', 'dateFormat')}
              hint="Format used when displaying dates across the application."
            >
              <select
                id="date-format"
                value={dateFormat}
                onChange={(e) => setDateFormat(e.target.value)}
                disabled={readOnly}
                className={inputClass('currency', 'dateFormat')}
              >
                {DATE_FORMAT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </Field>

            {defaultCurrency !== (org.settings.defaultCurrency ?? DEFAULT_CURRENCY) && (
              <div className="md:col-span-2 pt-2">
                <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmCurrencyChange}
                    onChange={(e) => setConfirmCurrencyChange(e.target.checked)}
                    disabled={readOnly}
                    className="mt-0.5 rounded border-input"
                  />
                  <span>
                    I confirm changing the workspace default currency from{' '}
                    <strong>{org.settings.defaultCurrency ?? DEFAULT_CURRENCY}</strong> to{' '}
                    <strong>{defaultCurrency}</strong>. Existing expenses and invoices retain their
                    original persisted currencies without foreign exchange conversion.
                  </span>
                </label>
              </div>
            )}
          </div>

          <SaveRow
            state={saves.currency}
            disabled={readOnly}
            label="Save Currency and Financial Defaults"
          />
        </form>
      </SectionCard>

      {/* 4. Invoice Preferences */}
      <SectionCard
        id="invoice"
        title="Invoice Preferences"
        description="Numbering format and tax defaults for customer invoices."
      >
        <form onSubmit={handleInvoiceSave} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field
              label="Number prefix"
              htmlFor="invoice-prefix"
              error={fieldError('invoice', 'invoiceNumberPrefix')}
              hint="Letters, numbers and dashes only (e.g. INV, ACME-INV)."
            >
              <input
                id="invoice-prefix"
                type="text"
                value={invoicePrefix}
                onChange={(e) => setInvoicePrefix(e.target.value.toUpperCase())}
                disabled={readOnly}
                className={`${inputClass('invoice', 'invoiceNumberPrefix')} font-mono uppercase`}
                placeholder="INV"
                maxLength={12}
              />
            </Field>

            <Field
              label="Next sequence number"
              htmlFor="invoice-next"
              error={fieldError('invoice', 'invoiceNextNumber')}
              hint="Positive integer. Never rewinds onto numbers already issued."
            >
              <input
                id="invoice-next"
                type="number"
                value={invoiceNextNumber}
                onChange={(e) => setInvoiceNextNumber(e.target.value)}
                disabled={readOnly}
                className={`${inputClass('invoice', 'invoiceNextNumber')} font-mono`}
                placeholder={org.nextNumbers.invoice.nextSequence.toString()}
                min={1}
                step={1}
              />
              <span className="sr-only">{org.nextNumbers.invoice.preview}</span>
            </Field>

            <Field
              label="Default tax rate (%)"
              htmlFor="invoice-tax"
              error={fieldError('invoice', 'invoiceTaxDefault')}
              hint="Percentage between 0 and 100 applied to new invoice line items."
            >
              <input
                id="invoice-tax"
                type="number"
                value={invoiceTaxDefault}
                onChange={(e) => setInvoiceTaxDefault(e.target.value)}
                disabled={readOnly}
                className={inputClass('invoice', 'invoiceTaxDefault')}
                placeholder="0"
                min={0}
                max={100}
                step="any"
              />
            </Field>
          </div>

          <SaveRow state={saves.invoice} disabled={readOnly} label="Save Invoice Preferences" />
        </form>
      </SectionCard>

      {/* 5. Proposal Preferences */}
      <SectionCard
        id="proposal"
        title="Proposal Preferences"
        description="Numbering format and validity window for client proposals."
      >
        <form onSubmit={handleProposalSave} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field
              label="Number prefix"
              htmlFor="proposal-prefix"
              error={fieldError('proposal', 'proposalNumberPrefix')}
              hint="Letters, numbers and dashes only (e.g. PRP, BID)."
            >
              <input
                id="proposal-prefix"
                type="text"
                value={proposalPrefix}
                onChange={(e) => setProposalPrefix(e.target.value.toUpperCase())}
                disabled={readOnly}
                className={`${inputClass('proposal', 'proposalNumberPrefix')} font-mono uppercase`}
                placeholder="PRP"
                maxLength={12}
              />
            </Field>

            <Field
              label="Next sequence number"
              htmlFor="proposal-next"
              error={fieldError('proposal', 'proposalNextNumber')}
              hint="Positive integer. Never rewinds onto numbers already issued."
            >
              <input
                id="proposal-next"
                type="number"
                value={proposalNextNumber}
                onChange={(e) => setProposalNextNumber(e.target.value)}
                disabled={readOnly}
                className={`${inputClass('proposal', 'proposalNextNumber')} font-mono`}
                placeholder={org.nextNumbers.proposal.nextSequence.toString()}
                min={1}
                step={1}
              />
              <span className="sr-only">{org.nextNumbers.proposal.preview}</span>
            </Field>

            <Field
              label="Validity (days)"
              htmlFor="proposal-days"
              error={fieldError('proposal', 'proposalValidDays')}
              hint="Number of days a newly drafted proposal remains valid."
            >
              <input
                id="proposal-days"
                type="number"
                value={proposalValidDays}
                onChange={(e) => setProposalValidDays(e.target.value)}
                disabled={readOnly}
                className={inputClass('proposal', 'proposalValidDays')}
                placeholder="30"
                min={1}
                max={365}
                step={1}
              />
            </Field>
          </div>

          <SaveRow state={saves.proposal} disabled={readOnly} label="Save Proposal Preferences" />
        </form>
      </SectionCard>

      {/* 6. User Profile */}
      <SectionCard
        id="profile"
        title="User Profile"
        description="Personal settings for your account. You can always update your own profile."
      >
        <form onSubmit={handleProfileSave} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field
              label="Email"
              htmlFor="user-email"
              hint="Managed by your organization administrator."
            >
              <input
                id="user-email"
                type="email"
                value={user.email}
                disabled
                className={`${inputClass('profile', 'email')} opacity-60 cursor-not-allowed`}
              />
            </Field>

            <Field label="Role" htmlFor="user-role" hint="Assigned by your organization.">
              <input
                id="user-role"
                type="text"
                value={user.role}
                disabled
                className={`${inputClass('profile', 'role')} opacity-60 cursor-not-allowed capitalize`}
              />
            </Field>

            <Field
              label="Display name"
              htmlFor="user-name"
              error={fieldError('profile', 'displayName')}
              hint="Your name as it appears to teammates and on documents you create."
            >
              <input
                id="user-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={inputClass('profile', 'displayName')}
                placeholder="Your name"
                maxLength={100}
              />
            </Field>

            <Field
              label="Avatar URL"
              htmlFor="user-avatar"
              error={fieldError('profile', 'avatarUrl')}
              hint="Absolute http(s) URL to your profile photo."
            >
              <input
                id="user-avatar"
                type="url"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                className={inputClass('profile', 'avatarUrl')}
                placeholder="https://example.com/avatar.jpg"
                maxLength={500}
              />
            </Field>
          </div>

          <SaveRow state={saves.profile} disabled={false} label="Save Profile" />
        </form>
      </SectionCard>
    </div>
  );
}
