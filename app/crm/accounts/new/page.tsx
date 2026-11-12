'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRouter } from 'next/navigation';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoAccountFormView } from '@/components/crm/bento-account-form-view';

export default function NewAccountPage() {
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
    name: '',
    website: '',
    address: '',
    status: 'active',
  });

  async function onSubmit(e?: React.FormEvent) {
    if (e?.preventDefault) e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const res = await fetch('/api/v1/crm/accounts', {
        method: 'POST',
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
        setError(errData.error || 'Failed to create account');
        return;
      }

      router.push('/crm/accounts');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create account');
    } finally {
      setIsLoading(false);
    }
  }

  if (isBento) {
    return (
      <BentoAccountFormView
        mode="new"
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

  // Legacy fallback view
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-2xl">New Account</CardTitle>
          <CardDescription>Create a new account for your organization</CardDescription>
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
                placeholder="e.g. Acme Corporation"
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
                placeholder="e.g. https://acme.example.com"
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
                placeholder="e.g. 123 Main Street, City, Country"
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
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push('/crm/accounts')}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? 'Creating...' : 'Create Account'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
