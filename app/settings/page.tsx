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
 */

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { listCurrencies, DEFAULT_CURRENCY } from '@/lib/currencies';
import { contrastRatio, readableForeground, resolveBrandTheme } from '@/lib/branding';

interface OrganizationSettings {
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

interface NumberingPreview {
  prefix: string;
  nextSequence: number;
  preview: string;
}

interface OrganizationResponse {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  settings: OrganizationSettings;
  nextNumbers: { invoice: NumberingPreview; proposal: NumberingPreview };
  isAdmin: boolean;
}

interface UserProfileResponse {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: string;
  status: string;
  organizationId: string | null;
}

type SectionKey = 'organization' | 'branding' | 'currency' | 'invoice' | 'proposal' | 'profile';

interface SaveState {
  status: 'idle' | 'saving' | 'success' | 'error';
  message?: string;
  fieldErrors?: Record<string, string>;
}

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

        // Branding is rendered by the shell, so a save must refresh the server
        // components for the new name/logo/colour to appear everywhere.
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

  const handleCurrencySave = (event: React.FormEvent) => {
    event.preventDefault();
    void saveOrganizationSection(
      'currency',
      { settings: { defaultCurrency, dateFormat } },
      'Currency and financial defaults saved.'
    );
  };

  const handleInvoiceSave = (event: React.FormEvent) => {
    event.preventDefault();
    void saveOrganizationSection(
      'invoice',
      { settings: buildInvoiceSettings() },
      'Invoice preferences saved.'
    );
  };

  // Required numeric fields are sent only when filled in: clearing them is
  // rejected by the API (a cleared counter must never look like a sequence
  // reset), so an empty input simply leaves the stored value untouched.
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
        description: currency.symbol ? `Symbol ${currency.symbol}` : undefined,
        keywords: currency.name,
      })),
    []
  );

  const brandPreview = useMemo(() => {
    if (!brandColor.trim()) return null;
    const theme = resolveBrandTheme(brandColor);
    if (!theme.custom) return { invalid: true as const };
    return {
      invalid: false as const,
      light: theme.light,
      dark: theme.dark,
      // The colour actually applied may differ from the stored one when it had
      // to be darkened/lightened to stay readable.
      adjusted:
        theme.light.accent.toLowerCase() !== brandColor.trim().toLowerCase() ||
        theme.dark.accent.toLowerCase() !== brandColor.trim().toLowerCase(),
      lightOnWhite: contrastRatio(theme.light.accent, '#ffffff'),
      darkOnSlate: contrastRatio(theme.dark.accent, '#1e293b'),
      lightForeground: readableForeground(theme.light.accent),
    };
  }, [brandColor]);

  const readOnly = org ? !org.isAdmin : true;

  const inputClass = (section: SectionKey, field: string) => {
    const invalid = Boolean(saves[section].fieldErrors?.[field]);
    return `w-full rounded-md border bg-background px-3 py-2 text-sm disabled:bg-muted/50 ${
      invalid ? 'border-destructive' : 'border-input'
    }`;
  };

  const fieldError = (section: SectionKey, field: string) => saves[section].fieldErrors?.[field];

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
            ['organization', 'Organization'],
            ['branding', 'Branding'],
            ['currency', 'Currency'],
            ['invoice', 'Invoices'],
            ['proposal', 'Proposals'],
            ['profile', 'Your Profile'],
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
                placeholder="+92 300 0000000"
              />
            </Field>

            <Field
              label="Address"
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
              />
            </Field>
          </div>

          <SaveRow
            state={saves.organization}
            disabled={readOnly}
            label="Save organization information"
          />
        </form>
      </SectionCard>

      {/* 2. Branding and Appearance */}
      <SectionCard
        id="branding"
        title="Branding and Appearance"
        description="Your brand name, logo and colour are applied to the app header and to invoices, proposals, quotations, estimates and contracts. “AgencyOS” remains the product name."
      >
        <form onSubmit={handleBrandingSave} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field
              label="Brand name"
              htmlFor="brand-name"
              error={fieldError('branding', 'brandName')}
              hint="Falls back to the organization name, then to AgencyOS."
            >
              <input
                id="brand-name"
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                disabled={readOnly}
                className={inputClass('branding', 'brandName')}
                placeholder={org.name || 'AgencyOS'}
                maxLength={120}
              />
            </Field>

            <Field
              label="Logo URL"
              htmlFor="brand-logo"
              error={fieldError('branding', 'logoUrl')}
              hint="Absolute https URL. Uploading files is not part of this phase."
            >
              <input
                id="brand-logo"
                type="url"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                disabled={readOnly}
                className={inputClass('branding', 'logoUrl')}
                placeholder="https://cdn.example.com/logo.png"
              />
            </Field>
          </div>

          <Field
            label="Brand color"
            htmlFor="brand-color"
            error={fieldError('branding', 'brandColor')}
            hint="Drives primary buttons, navigation highlights, focus rings and document accents. Contrast is adjusted automatically where needed."
          >
            <div className="flex flex-wrap items-center gap-3">
              <input
                id="brand-color"
                type="color"
                value={brandPreview && !brandPreview.invalid ? brandColor : '#047857'}
                onChange={(e) => setBrandColor(e.target.value)}
                disabled={readOnly}
                aria-label="Pick brand color"
                className="h-10 w-14 cursor-pointer rounded-md border border-input bg-background disabled:cursor-not-allowed disabled:opacity-50"
              />
              <input
                type="text"
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                disabled={readOnly}
                aria-label="Brand color hex value"
                placeholder="#047857"
                className={`${inputClass('branding', 'brandColor')} max-w-40 font-mono`}
                maxLength={7}
              />
              {brandColor.trim() === '' && (
                <span className="text-xs text-muted-foreground">Using the default accent</span>
              )}
            </div>
          </Field>

          {brandPreview && (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              {brandPreview.invalid ? (
                <p className="text-sm text-destructive">
                  Enter a hex colour such as #047857 (or clear the field to use the default).
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span
                      className="rounded-md px-3 py-1.5 text-sm font-medium"
                      style={{
                        backgroundColor: brandPreview.light.accent,
                        color: brandPreview.lightForeground,
                      }}
                    >
                      Primary button
                    </span>
                    <span
                      className="rounded-md px-3 py-1.5 text-sm"
                      style={{
                        backgroundColor: brandPreview.dark.accent,
                        color: readableForeground(brandPreview.dark.accent),
                      }}
                    >
                      Dark mode accent
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Light contrast {brandPreview.lightOnWhite.toFixed(2)}:1 · Dark contrast{' '}
                      {brandPreview.darkOnSlate.toFixed(2)}:1
                    </span>
                  </div>
                  {brandPreview.adjusted && (
                    <p className="text-xs text-muted-foreground">
                      The colour was adjusted slightly so text on it stays readable (WCAG AA).
                      Danger, warning and success colours are never changed.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <SaveRow state={saves.branding} disabled={readOnly} label="Save branding" />
        </form>
      </SectionCard>

      {/* 3. Currency and Financial Defaults */}
      <SectionCard
        id="currency"
        title="Currency and Financial Defaults"
        description="Applied as the default to new documents. Existing documents keep their original currency — no exchange rates are used and nothing is converted."
      >
        <form onSubmit={handleCurrencySave} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field
              label="Default currency"
              htmlFor="default-currency"
              error={fieldError('currency', 'defaultCurrency')}
              hint="Pre-selected on new invoices, proposals, quotes and opportunities."
            >
              <Combobox
                id="default-currency"
                options={currencyOptions}
                value={defaultCurrency}
                onChange={setDefaultCurrency}
                disabled={readOnly}
                placeholder="Select a currency"
                searchPlaceholder="Search currencies…"
                emptyMessage="No matching currency"
                aria-invalid={Boolean(fieldError('currency', 'defaultCurrency'))}
              />
            </Field>

            <Field
              label="Date format"
              htmlFor="date-format"
              error={fieldError('currency', 'dateFormat')}
              hint="Used when displaying dates on documents."
            >
              <select
                id="date-format"
                value={dateFormat}
                onChange={(e) => setDateFormat(e.target.value)}
                disabled={readOnly}
                className={inputClass('currency', 'dateFormat')}
              >
                {DATE_FORMAT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <SaveRow state={saves.currency} disabled={readOnly} label="Save financial defaults" />
        </form>
      </SectionCard>

      {/* 4. Invoice Preferences */}
      <SectionCard
        id="invoice"
        title="Invoice Preferences"
        description="Invoice numbers use the prefix, the year and a sequence that increments automatically for each new invoice. Issued invoices are never renumbered."
      >
        <form onSubmit={handleInvoiceSave} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Field
              label="Number prefix"
              htmlFor="invoice-prefix"
              error={fieldError('invoice', 'invoiceNumberPrefix')}
              hint="Letters, numbers and dashes."
            >
              <input
                id="invoice-prefix"
                type="text"
                value={invoicePrefix}
                onChange={(e) => setInvoicePrefix(e.target.value)}
                disabled={readOnly}
                className={inputClass('invoice', 'invoiceNumberPrefix')}
                placeholder="INV"
                maxLength={12}
              />
            </Field>

            <Field
              label="Next number"
              htmlFor="invoice-next"
              error={fieldError('invoice', 'invoiceNextNumber')}
              hint={`The next invoice will be ${org.nextNumbers.invoice.preview}.`}
            >
              <input
                id="invoice-next"
                type="number"
                min={1}
                step={1}
                value={invoiceNextNumber}
                onChange={(e) => setInvoiceNextNumber(e.target.value)}
                disabled={readOnly}
                className={inputClass('invoice', 'invoiceNextNumber')}
              />
            </Field>

            <Field
              label="Default tax rate (%)"
              htmlFor="invoice-tax"
              error={fieldError('invoice', 'invoiceTaxDefault')}
              hint="Pre-filled on new invoice line items. Existing invoices are not changed."
            >
              <input
                id="invoice-tax"
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={invoiceTaxDefault}
                onChange={(e) => setInvoiceTaxDefault(e.target.value)}
                disabled={readOnly}
                className={inputClass('invoice', 'invoiceTaxDefault')}
              />
            </Field>
          </div>

          <SaveRow state={saves.invoice} disabled={readOnly} label="Save invoice preferences" />
        </form>
      </SectionCard>

      {/* 5. Proposal Preferences */}
      <SectionCard
        id="proposal"
        title="Proposal Preferences"
        description="Proposal numbers are allocated the same way as invoices, with their own prefix and sequence."
      >
        <form onSubmit={handleProposalSave} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Field
              label="Number prefix"
              htmlFor="proposal-prefix"
              error={fieldError('proposal', 'proposalNumberPrefix')}
            >
              <input
                id="proposal-prefix"
                type="text"
                value={proposalPrefix}
                onChange={(e) => setProposalPrefix(e.target.value)}
                disabled={readOnly}
                className={inputClass('proposal', 'proposalNumberPrefix')}
                placeholder="PRP"
                maxLength={12}
              />
            </Field>

            <Field
              label="Next number"
              htmlFor="proposal-next"
              error={fieldError('proposal', 'proposalNextNumber')}
              hint={`The next proposal will be ${org.nextNumbers.proposal.preview}.`}
            >
              <input
                id="proposal-next"
                type="number"
                min={1}
                step={1}
                value={proposalNextNumber}
                onChange={(e) => setProposalNextNumber(e.target.value)}
                disabled={readOnly}
                className={inputClass('proposal', 'proposalNextNumber')}
              />
            </Field>

            <Field
              label="Validity (days)"
              htmlFor="proposal-validity"
              error={fieldError('proposal', 'proposalValidDays')}
              hint="Used to pre-fill the expiry date on new proposals."
            >
              <input
                id="proposal-validity"
                type="number"
                min={1}
                max={365}
                step={1}
                value={proposalValidDays}
                onChange={(e) => setProposalValidDays(e.target.value)}
                disabled={readOnly}
                className={inputClass('proposal', 'proposalValidDays')}
              />
            </Field>
          </div>

          <SaveRow state={saves.proposal} disabled={readOnly} label="Save proposal preferences" />
        </form>
      </SectionCard>

      {/* 6. User Profile */}
      <SectionCard
        id="profile"
        title="User Profile"
        description="Your own display name and avatar. Email, role and status are managed by an administrator."
      >
        <form onSubmit={handleProfileSave} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field
              label="Display name"
              htmlFor="profile-name"
              error={fieldError('profile', 'displayName')}
              hint="Shown in the header and on activity entries."
            >
              <input
                id="profile-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={inputClass('profile', 'displayName')}
                placeholder="Your name"
                maxLength={120}
              />
            </Field>

            <Field
              label="Avatar URL"
              htmlFor="profile-avatar"
              error={fieldError('profile', 'avatarUrl')}
              hint="Absolute https URL; leave empty to remove your avatar."
            >
              <input
                id="profile-avatar"
                type="url"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                className={inputClass('profile', 'avatarUrl')}
                placeholder="https://example.com/avatar.png"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="Email" htmlFor="profile-email" hint="Cannot be changed here.">
              <input
                id="profile-email"
                type="email"
                value={user.email}
                readOnly
                className="w-full rounded-md border border-input bg-muted/50 px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Role" htmlFor="profile-role">
              <input
                id="profile-role"
                type="text"
                value={user.role}
                readOnly
                className="w-full rounded-md border border-input bg-muted/50 px-3 py-2 text-sm capitalize"
              />
            </Field>
            <Field label="Status" htmlFor="profile-status">
              <input
                id="profile-status"
                type="text"
                value={user.status}
                readOnly
                className="w-full rounded-md border border-input bg-muted/50 px-3 py-2 text-sm capitalize"
              />
            </Field>
          </div>

          <SaveRow state={saves.profile} disabled={false} label="Save profile" />
        </form>
      </SectionCard>
    </div>
  );
}
