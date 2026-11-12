'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRouter } from 'next/navigation';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoAccountFormView } from '@/components/crm/bento-account-form-view';

interface EditAccountFormProps {
  account: {
    id: string;
    name: string;
    website: string | null;
    address: string | null;
    status: string;
  };
}

export function EditAccountForm({ account }: EditAccountFormProps) {
  const isBento = useBentoShell();
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);

  const [formData, setFormData] = React.useState<{
    name: string;
    website: string;
    address: string;
    status: string;
  }>({
    name: account.name,
    website: account.website ?? '',
    address: account.address ?? '',
    status: account.status,
  });

  async function onSubmit(e?: React.FormEvent) {
    if (e?.preventDefault) e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const res = await fetch(`/api/v1/crm/accounts/${account.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: formData.name,
          website: formData.website || null,
          address: formData.address || null,
          status: formData.status,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || 'Failed to update account');
        return;
      }

      router.push(`/crm/accounts/${account.id}`);
      router.refresh();
    } catch {
      setError('Unable to update account');
    } finally {
      setIsLoading(false);
    }
  }

  if (isBento) {
    return (
      <BentoAccountFormView
        mode="edit"
        accountId={account.id}
        name={formData.name}
        setName={(val) => setFormData((prev) => ({ ...prev, name: val }))}
        website={formData.website}
        setWebsite={(val) => setFormData((prev) => ({ ...prev, website: val }))}
        address={formData.address}
        setAddress={(val) => setFormData((prev) => ({ ...prev, address: val }))}
        status={formData.status}
        setStatus={(val) => setFormData((prev) => ({ ...prev, status: val }))}
        onSubmit={onSubmit}
        isLoading={isLoading}
        error={error}
      />
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-2xl">Edit Account</CardTitle>
          <CardDescription>Update account details for {account.name}</CardDescription>
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
              <label htmlFor="name" className="block text-sm font-medium text-foreground">
                Account Name <span className="text-destructive">*</span>
              </label>
              <Input
                id="name"
                defaultValue={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="website" className="block text-sm font-medium text-foreground">
                Website
              </label>
              <Input
                id="website"
                type="url"
                defaultValue={formData.website}
                onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="address" className="block text-sm font-medium text-foreground">
                Address
              </label>
              <Input
                id="address"
                defaultValue={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
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
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Saving...' : 'Save Account'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push(`/crm/accounts/${account.id}`)}
              disabled={isLoading}
              className="w-full mt-2"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (window.confirm('Archive this account?')) {
                  fetch(`/api/v1/crm/accounts/${account.id}`, {
                    method: 'DELETE',
                    credentials: 'include',
                  })
                    .then((res) => {
                      if (!res.ok) {
                        setError('Unable to archive account');
                        return;
                      }
                      router.push('/crm/accounts');
                      router.refresh();
                    })
                    .catch(() => {
                      setError('Unable to archive account');
                    });
                }
              }}
              className="w-full mt-2"
            >
              Archive Account
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
