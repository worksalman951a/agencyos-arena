'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRouter } from 'next/navigation';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import {
  BentoOpportunityFormView,
  type OpportunityFormData,
} from '@/components/crm/bento-opportunity-form-view';

export default function CreateOpportunityPage() {
  const isBento = useBentoShell();
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);

  const [formData, setFormData] = React.useState<OpportunityFormData>({
    contactId: '',
    accountId: '',
    leadId: '',
    pipelineId: '',
    stageId: '',
    title: '',
    description: '',
    value: '',
    currency: 'USD',
    closeDate: '',
    ownerId: '',
    status: 'open',
    probability: '',
    lossReason: '',
  });

  async function onSubmit() {
    setError(null);
    setIsLoading(true);
    try {
      const res = await fetch('/api/v1/crm/opportunities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          contactId: formData.contactId || null,
          accountId: formData.accountId || null,
          leadId: formData.leadId || null,
          pipelineId: formData.pipelineId || null,
          stageId: formData.stageId || null,
          title: formData.title,
          description: formData.description || null,
          value: formData.value || null,
          currency: formData.currency || 'USD',
          closeDate: formData.closeDate || null,
          ownerId: formData.ownerId || null,
          status: formData.status,
          probability: formData.probability || null,
          lossReason: formData.lossReason || null,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || 'Failed to create opportunity');
        return;
      }

      router.push('/crm/opportunities');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create opportunity');
    } finally {
      setIsLoading(false);
    }
  }

  if (isBento) {
    return (
      <BentoOpportunityFormView
        mode="new"
        formData={formData}
        setFormData={setFormData}
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
          <CardTitle className="text-2xl">New Opportunity</CardTitle>
          <CardDescription>Create a new sales opportunity for your organization</CardDescription>
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
              onSubmit();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <label htmlFor="title" className="block text-sm font-medium text-foreground">
                Title <span className="text-destructive">*</span>
              </label>
              <Input
                id="title"
                defaultValue={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g. Enterprise Software Deal"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="description" className="block text-sm font-medium text-foreground">
                Description
              </label>
              <textarea
                id="description"
                defaultValue={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
                placeholder="Add opportunity description..."
                className="flex h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="value" className="block text-sm font-medium text-foreground">
                Value ($)
              </label>
              <Input
                id="value"
                type="number"
                min="0"
                step="0.01"
                defaultValue={formData.value}
                onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                placeholder="0.00"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="currency" className="block text-sm font-medium text-foreground">
                Currency
              </label>
              <select
                id="currency"
                defaultValue={formData.currency}
                onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="PKR">PKR</option>
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="closeDate" className="block text-sm font-medium text-foreground">
                Expected Close Date
              </label>
              <Input
                id="closeDate"
                type="date"
                defaultValue={formData.closeDate}
                onChange={(e) => setFormData({ ...formData, closeDate: e.target.value })}
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
                <option value="open">Open</option>
                <option value="won">Won</option>
                <option value="lost">Lost</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="probability" className="block text-sm font-medium text-foreground">
                Probability of Closing (%)
              </label>
              <Input
                id="probability"
                type="number"
                min="0"
                max="100"
                step="1"
                defaultValue={formData.probability}
                onChange={(e) => setFormData({ ...formData, probability: e.target.value })}
                placeholder="0-100"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="lossReason" className="block text-sm font-medium text-foreground">
                Loss Reason
              </label>
              <textarea
                id="lossReason"
                defaultValue={formData.lossReason}
                onChange={(e) => setFormData({ ...formData, lossReason: e.target.value })}
                rows={2}
                placeholder="Reason for losing this opportunity..."
                className="flex h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="contactId" className="block text-sm font-medium text-foreground">
                Contact ID
              </label>
              <Input
                id="contactId"
                defaultValue={formData.contactId}
                onChange={(e) => setFormData({ ...formData, contactId: e.target.value })}
                placeholder="e.g. cmxxxxxxx"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="accountId" className="block text-sm font-medium text-foreground">
                Account ID
              </label>
              <Input
                id="accountId"
                defaultValue={formData.accountId}
                onChange={(e) => setFormData({ ...formData, accountId: e.target.value })}
                placeholder="e.g. cmxxxxxxx"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="leadId" className="block text-sm font-medium text-foreground">
                Lead ID
              </label>
              <Input
                id="leadId"
                defaultValue={formData.leadId}
                onChange={(e) => setFormData({ ...formData, leadId: e.target.value })}
                placeholder="e.g. cmxxxxxxx"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="pipelineId" className="block text-sm font-medium text-foreground">
                Pipeline ID
              </label>
              <Input
                id="pipelineId"
                defaultValue={formData.pipelineId}
                onChange={(e) => setFormData({ ...formData, pipelineId: e.target.value })}
                placeholder="e.g. cmxxxxxxx"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="stageId" className="block text-sm font-medium text-foreground">
                Stage ID
              </label>
              <Input
                id="stageId"
                defaultValue={formData.stageId}
                onChange={(e) => setFormData({ ...formData, stageId: e.target.value })}
                placeholder="e.g. cmxxxxxxx"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="ownerId" className="block text-sm font-medium text-foreground">
                Owner / Assignee ID
              </label>
              <Input
                id="ownerId"
                defaultValue={formData.ownerId}
                onChange={(e) => setFormData({ ...formData, ownerId: e.target.value })}
                placeholder="e.g. cmxxxxxxx"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Creating...' : 'Create Opportunity'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push('/crm/opportunities')}
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
