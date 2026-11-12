'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRouter } from 'next/navigation';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoContactFormView } from '@/components/crm/bento-contact-form-view';

interface Account {
  id: string;
  name: string;
}

export default function NewContactPage() {
  const isBento = useBentoShell();
  const router = useRouter();
  const [error, setError] = React.useState<{ message: string; field?: string } | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = React.useState(false);
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const [accountsLoading, setAccountsLoading] = React.useState(true);

  const [formData, setFormData] = React.useState<{
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    accountId: string;
    status: string;
    source: string;
  }>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    accountId: '',
    status: 'active',
    source: '',
  });

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      setAccountsLoading(true);
      try {
        const res = await fetch('/api/v1/crm/accounts', {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        });
        if (!mounted) return;
        if (!res.ok) return;
        const data = await res.json();
        if (!mounted) return;
        setAccounts(data.accounts || []);
      } catch {
        // Silently fail - account selector will just be empty
      } finally {
        if (mounted) setAccountsLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  function clearFieldError(field: string) {
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  async function onSubmit(e?: React.FormEvent) {
    if (e?.preventDefault) e.preventDefault();
    setError(null);
    setFieldErrors({});
    setIsLoading(true);
    try {
      const res = await fetch('/api/v1/crm/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          accountId: formData.accountId || null,
          firstName: formData.firstName || null,
          lastName: formData.lastName,
          email: formData.email || null,
          phone: formData.phone || null,
          status: formData.status,
          source: formData.source || null,
        }),
      });

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as {
          error?: string;
          issues?: Array<{ path: string[]; message: string }>;
        };
        if (res.status === 401) {
          router.push('/login');
          return;
        }
        // Handle field-specific validation errors
        if (errData.issues && Array.isArray(errData.issues)) {
          const fieldMap: Record<string, string> = {};
          for (const issue of errData.issues) {
            const field = issue.path[0];
            if (field) {
              fieldMap[field] = issue.message;
            }
          }
          setFieldErrors(fieldMap);
          setError({
            message: errData.error || 'Failed to create contact',
            field: Object.keys(fieldMap)[0] || undefined,
          });
          return;
        }
        setError({ message: errData.error || 'Failed to create contact' });
        return;
      }

      router.push('/crm/contacts');
      router.refresh();
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : 'Unable to create contact' });
    } finally {
      setIsLoading(false);
    }
  }

  if (isBento) {
    return (
      <BentoContactFormView
        mode="new"
        firstName={formData.firstName}
        setFirstName={(val) => {
          setFormData((prev) => ({ ...prev, firstName: val }));
          clearFieldError('firstName');
        }}
        lastName={formData.lastName}
        setLastName={(val) => {
          setFormData((prev) => ({ ...prev, lastName: val }));
          clearFieldError('lastName');
        }}
        email={formData.email}
        setEmail={(val) => {
          setFormData((prev) => ({ ...prev, email: val }));
          clearFieldError('email');
        }}
        phone={formData.phone}
        setPhone={(val) => {
          setFormData((prev) => ({ ...prev, phone: val }));
          clearFieldError('phone');
        }}
        accountId={formData.accountId}
        setAccountId={(val) => {
          setFormData((prev) => ({ ...prev, accountId: val }));
          clearFieldError('accountId');
        }}
        status={formData.status}
        setStatus={(val) => {
          setFormData((prev) => ({ ...prev, status: val }));
          clearFieldError('status');
        }}
        source={formData.source}
        setSource={(val) => {
          setFormData((prev) => ({ ...prev, source: val }));
          clearFieldError('source');
        }}
        accounts={accounts}
        accountsLoading={accountsLoading}
        onSubmit={onSubmit}
        isLoading={isLoading}
        error={error ? error.message : null}
        fieldErrors={fieldErrors}
      />
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-2xl">New Contact</CardTitle>
          <CardDescription>Create a new contact for your organization</CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2 mb-4">
              <span>{error.message}</span>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void onSubmit();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <label htmlFor="firstName" className="block text-sm font-medium text-foreground">
                First Name
              </label>
              <Input
                id="firstName"
                defaultValue={formData.firstName}
                onChange={(e) => {
                  setFormData({ ...formData, firstName: e.target.value });
                  clearFieldError('firstName');
                }}
                placeholder="e.g. Jane"
                className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                  fieldErrors.firstName ? 'border-destructive' : ''
                }`}
              />
              {fieldErrors.firstName && (
                <p className="text-xs text-destructive">{fieldErrors.firstName}</p>
              )}
            </div>
            <div className="space-y-2">
              <label htmlFor="lastName" className="block text-sm font-medium text-foreground">
                Last Name <span className="text-destructive">*</span>
              </label>
              <Input
                id="lastName"
                defaultValue={formData.lastName}
                onChange={(e) => {
                  setFormData({ ...formData, lastName: e.target.value });
                  clearFieldError('lastName');
                }}
                placeholder="e.g. Smith"
                className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                  fieldErrors.lastName ? 'border-destructive' : ''
                }`}
              />
              {fieldErrors.lastName && (
                <p className="text-xs text-destructive">{fieldErrors.lastName}</p>
              )}
            </div>
            <div className="space-y-2">
              <label htmlFor="email" className="block text-sm font-medium text-foreground">
                Email
              </label>
              <Input
                id="email"
                type="email"
                defaultValue={formData.email}
                onChange={(e) => {
                  setFormData({ ...formData, email: e.target.value });
                  clearFieldError('email');
                }}
                placeholder="e.g. jane@example.com"
                className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                  fieldErrors.email ? 'border-destructive' : ''
                }`}
              />
              {fieldErrors.email && <p className="text-xs text-destructive">{fieldErrors.email}</p>}
            </div>
            <div className="space-y-2">
              <label htmlFor="phone" className="block text-sm font-medium text-foreground">
                Phone
              </label>
              <Input
                id="phone"
                type="tel"
                defaultValue={formData.phone}
                onChange={(e) => {
                  setFormData({ ...formData, phone: e.target.value });
                  clearFieldError('phone');
                }}
                placeholder="e.g. +1-555-123-4567"
                className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                  fieldErrors.phone ? 'border-destructive' : ''
                }`}
              />
              {fieldErrors.phone && <p className="text-xs text-destructive">{fieldErrors.phone}</p>}
            </div>
            <div className="space-y-2">
              <label htmlFor="accountId" className="block text-sm font-medium text-foreground">
                Account
              </label>
              {accountsLoading ? (
                <div className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <span className="text-xs text-muted-foreground">Loading accounts...</span>
                </div>
              ) : (
                <Select
                  onValueChange={(value) => {
                    setFormData({ ...formData, accountId: value ?? '' });
                    clearFieldError('accountId');
                  }}
                  defaultValue={formData.accountId || undefined}
                >
                  <SelectTrigger
                    id="accountId"
                    className={`flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                      fieldErrors.accountId ? 'border-destructive' : ''
                    }`}
                  >
                    <SelectValue placeholder="No account" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">No account</SelectItem>
                    {accounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {fieldErrors.accountId && (
                <p className="text-xs text-destructive">{fieldErrors.accountId}</p>
              )}
            </div>
            <div className="space-y-2">
              <label htmlFor="status" className="block text-sm font-medium text-foreground">
                Status <span className="text-destructive">*</span>
              </label>
              <select
                id="status"
                defaultValue={formData.status}
                onChange={(e) => {
                  setFormData({ ...formData, status: e.target.value });
                  clearFieldError('status');
                }}
                className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                  fieldErrors.status ? 'border-destructive' : ''
                }`}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              {fieldErrors.status && (
                <p className="text-xs text-destructive">{fieldErrors.status}</p>
              )}
            </div>
            <div className="space-y-2">
              <label htmlFor="source" className="block text-sm font-medium text-foreground">
                Source
              </label>
              <Input
                id="source"
                defaultValue={formData.source}
                onChange={(e) => {
                  setFormData({ ...formData, source: e.target.value });
                  clearFieldError('source');
                }}
                placeholder="e.g. website, referral, cold_call"
                className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                  fieldErrors.source ? 'border-destructive' : ''
                }`}
              />
              {fieldErrors.source && (
                <p className="text-xs text-destructive">{fieldErrors.source}</p>
              )}
            </div>
            <div className="text-xs text-muted-foreground mb-4">
              At least one contact identifier (name, email, or phone) is required.
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Creating...' : 'Create Contact'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push('/crm/contacts')}
              disabled={isLoading}
              className="w-full mt-2"
            >
              Cancel
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
