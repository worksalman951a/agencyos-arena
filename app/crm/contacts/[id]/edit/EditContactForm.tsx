'use client';

import * as React from 'react';
import { useEffect } from 'react';
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
import { useToast } from '@/components/ui/toast';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoContactFormView } from '@/components/crm/bento-contact-form-view';

interface EditContactFormProps {
  contact: {
    id: string;
    firstName: string | null;
    lastName: string;
    email: string | null;
    phone: string | null;
    accountId: string | null;
    status: string;
    source: string | null;
  };
}

export function EditContactForm({ contact }: EditContactFormProps) {
  const isBento = useBentoShell();
  const router = useRouter();
  const { toast } = useToast();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = React.useState(false);
  const [accounts, setAccounts] = React.useState<Array<{ id: string; name: string }>>([]);
  const [accountsLoading, setAccountsLoading] = React.useState(true);

  useEffect(() => {
    fetch('/api/v1/crm/accounts', { credentials: 'include' })
      .then((res) => res.json())
      .then((data: { accounts: Array<{ id: string; name: string }> }) => {
        setAccounts(data.accounts ?? []);
      })
      .catch(() => {
        setAccounts([]);
      })
      .finally(() => {
        setAccountsLoading(false);
      });
  }, []);

  const [formData, setFormData] = React.useState<{
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    accountId: string;
    status: string;
    source: string;
  }>({
    firstName: contact.firstName ?? '',
    lastName: contact.lastName,
    email: contact.email ?? '',
    phone: contact.phone ?? '',
    accountId: contact.accountId ?? '',
    status: contact.status,
    source: contact.source ?? '',
  });

  async function onSubmit(e?: React.FormEvent) {
    if (e?.preventDefault) e.preventDefault();
    setError(null);
    setFieldErrors({});
    setIsLoading(true);
    try {
      const res = await fetch(`/api/v1/crm/contacts/${contact.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          firstName: formData.firstName || null,
          lastName: formData.lastName,
          email: formData.email || null,
          phone: formData.phone || null,
          accountId: formData.accountId || null,
          status: formData.status,
          source: formData.source || null,
        }),
      });

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as {
          error?: string;
          issues?: Array<{ path: string[]; message: string }>;
        };
        if (errData.issues && Array.isArray(errData.issues)) {
          const fieldMap: Record<string, string> = {};
          for (const issue of errData.issues) {
            const field = issue.path[0];
            if (field) {
              fieldMap[field] = issue.message;
            }
          }
          setFieldErrors(fieldMap);
          setError(errData.error || 'Please correct the errors below');
          return;
        }
        setError(errData.error || 'Failed to update contact');
        return;
      }

      router.push(`/crm/contacts/${contact.id}`);
      router.refresh();
      toast({ title: 'Saved', description: 'Contact has been updated' });
    } catch {
      setError('Unable to update contact');
    } finally {
      setIsLoading(false);
    }
  }

  if (isBento) {
    return (
      <BentoContactFormView
        mode="edit"
        contactId={contact.id}
        firstName={formData.firstName}
        setFirstName={(val) => setFormData((prev) => ({ ...prev, firstName: val }))}
        lastName={formData.lastName}
        setLastName={(val) => setFormData((prev) => ({ ...prev, lastName: val }))}
        email={formData.email}
        setEmail={(val) => setFormData((prev) => ({ ...prev, email: val }))}
        phone={formData.phone}
        setPhone={(val) => setFormData((prev) => ({ ...prev, phone: val }))}
        accountId={formData.accountId}
        setAccountId={(val) => setFormData((prev) => ({ ...prev, accountId: val }))}
        status={formData.status}
        setStatus={(val) => setFormData((prev) => ({ ...prev, status: val }))}
        source={formData.source}
        setSource={(val) => setFormData((prev) => ({ ...prev, source: val }))}
        accounts={accounts}
        accountsLoading={accountsLoading}
        onSubmit={onSubmit}
        isLoading={isLoading}
        error={error}
        fieldErrors={fieldErrors}
      />
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-2xl">Edit Contact</CardTitle>
          <CardDescription>
            Update contact details for {contact.firstName} {contact.lastName}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2 mb-4">
              <span>{error}</span>
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
                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="lastName" className="block text-sm font-medium text-foreground">
                Last Name <span className="text-destructive">*</span>
              </label>
              <Input
                id="lastName"
                defaultValue={formData.lastName}
                onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="email" className="block text-sm font-medium text-foreground">
                Email
              </label>
              <Input
                id="email"
                type="email"
                defaultValue={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="phone" className="block text-sm font-medium text-foreground">
                Phone
              </label>
              <Input
                id="phone"
                type="tel"
                defaultValue={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="accountId" className="block text-sm font-medium text-foreground">
                Account ID
              </label>
              <Select
                defaultValue={formData.accountId}
                onValueChange={(value) => setFormData({ ...formData, accountId: value ?? '' })}
              >
                <SelectTrigger
                  id="accountId"
                  className="flex h-10 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
            </div>
            <div className="space-y-2">
              <label htmlFor="status" className="block text-sm font-medium text-foreground">
                Status <span className="text-destructive">*</span>
              </label>
              <select
                id="status"
                defaultValue={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="source" className="block text-sm font-medium text-foreground">
                Source
              </label>
              <Input
                id="source"
                defaultValue={formData.source}
                onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                placeholder="e.g. website, referral, cold_call"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Saving...' : 'Save Contact'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push(`/crm/contacts/${contact.id}`)}
              disabled={isLoading}
              className="w-full mt-2"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (window.confirm('Archive this contact?')) {
                  fetch(`/api/v1/crm/contacts/${contact.id}`, {
                    method: 'DELETE',
                    credentials: 'include',
                  })
                    .then((res) => {
                      if (!res.ok) {
                        setError('Unable to archive contact');
                        toast({
                          title: 'Delete failed',
                          description: 'Unable to delete contact',
                          variant: 'destructive',
                        });
                        return;
                      }
                      toast({ title: 'Deleted', description: 'Contact has been deleted' });
                      router.push('/crm/contacts');
                      router.refresh();
                    })
                    .catch(() => {
                      setError('Unable to archive contact');
                      toast({
                        title: 'Delete failed',
                        description: 'Unable to delete contact',
                        variant: 'destructive',
                      });
                    });
                }
              }}
              className="w-full mt-2"
            >
              Archive Contact
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
