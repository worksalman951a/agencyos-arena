'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import {
  BentoConvertLeadView,
  type ConvertLeadFormData,
} from '@/components/crm/bento-convert-lead-view';

interface ConvertFormProps {
  leadId: string;
  lead: {
    id: string;
    source: string;
    status: string;
    expectedValue: string | null;
    contactId: string | null;
    accountId: string | null;
    ownerId: string | null;
    pipelineId: string | null;
    stageId: string | null;
    convertedOpportunity: {
      id: string;
      title: string;
      status: string;
      value: string | null;
      currency: string;
    } | null;
  };
}

export function ConvertForm({ leadId, lead }: ConvertFormProps) {
  const isBento = useBentoShell();
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [success, setSuccess] = React.useState<{
    opportunityId: string;
    opportunityTitle: string;
  } | null>(null);

  const [formData, setFormData] = React.useState<ConvertLeadFormData>({
    title: '',
    description: '',
    value: lead.expectedValue ?? '',
    currency: 'USD',
    pipelineId: lead.pipelineId ?? '',
    stageId: lead.stageId ?? '',
    ownerId: lead.ownerId ?? '',
    closeDate: '',
  });

  async function onSubmit() {
    setError(null);
    setIsLoading(true);
    try {
      const res = await fetch(`/api/v1/crm/leads/${leadId}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: formData.title,
          description: formData.description || null,
          value: formData.value || null,
          currency: formData.currency || 'USD',
          pipelineId: formData.pipelineId || null,
          stageId: formData.stageId || null,
          ownerId: formData.ownerId || null,
          closeDate: formData.closeDate || null,
        }),
      });

      if (res.status === 409) {
        setError('This lead has already been converted to an opportunity.');
        return;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || 'Failed to convert lead');
        return;
      }

      const data = await res.json();
      setSuccess({
        opportunityId: data.opportunity.id,
        opportunityTitle: data.opportunity.title,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to convert lead');
    } finally {
      setIsLoading(false);
    }
  }

  if (isBento) {
    return (
      <BentoConvertLeadView
        leadId={leadId}
        lead={lead}
        formData={formData}
        setFormData={setFormData}
        onSubmit={onSubmit}
        isLoading={isLoading}
        error={error}
        success={success}
      />
    );
  }

  // If already converted, show the already-converted state
  if (lead.convertedOpportunity) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle className="text-2xl">Already Converted</CardTitle>
            <CardDescription>
              This lead has already been converted to an opportunity.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md bg-blue-50 p-4 text-sm text-blue-900 flex items-center gap-2">
              <span>✓</span>
              <span>
                Lead <strong>#{leadId.slice(-6)}</strong> has been converted to opportunity{' '}
                <strong>{lead.convertedOpportunity.title}</strong>.
              </span>
            </div>
            <div className="space-y-2">
              <dt className="text-xs text-muted-foreground">Opportunity</dt>
              <dd className="font-medium">
                <Link
                  href={`/crm/opportunities/${lead.convertedOpportunity.id}`}
                  className="text-accent hover:underline"
                >
                  {lead.convertedOpportunity.title}
                </Link>
              </dd>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd className="font-medium">{lead.convertedOpportunity.status}</dd>
              <dt className="text-xs text-muted-foreground">Value</dt>
              <dd className="font-medium">
                {lead.convertedOpportunity.value
                  ? `${lead.convertedOpportunity.currency} ${Number(
                      lead.convertedOpportunity.value
                    ).toLocaleString()}`
                  : '—'}
              </dd>
            </div>
            <Button
              type="button"
              onClick={() => router.push(`/crm/leads/${leadId}`)}
              className="w-full"
            >
              Back to Lead
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-2xl">Convert to Opportunity</CardTitle>
          <CardDescription>
            Convert lead #{leadId.slice(-6)} ({lead.source}) into an opportunity
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2 mb-4">
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-900 flex items-center gap-2 mb-4 border border-green/30">
              <span>✓</span>
              <span>
                Lead converted to opportunity <strong>{success.opportunityTitle}</strong>.
              </span>
            </div>
          )}
          {!success && (
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
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <p className="text-xs text-muted-foreground">Opportunity title (required)</p>
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
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <p className="text-xs text-muted-foreground">
                  Defaults to lead expected value (
                  {lead.expectedValue
                    ? `$${Number(lead.expectedValue).toLocaleString()}`
                    : 'not set'}
                  )
                </p>
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
                <label htmlFor="pipelineId" className="block text-sm font-medium text-foreground">
                  Pipeline ID
                </label>
                <Input
                  id="pipelineId"
                  defaultValue={formData.pipelineId}
                  onChange={(e) => setFormData({ ...formData, pipelineId: e.target.value })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <p className="text-xs text-muted-foreground">
                  Defaults to lead pipeline ({lead.pipelineId ?? 'not set'})
                </p>
              </div>
              <div className="space-y-2">
                <label htmlFor="stageId" className="block text-sm font-medium text-foreground">
                  Stage ID
                </label>
                <Input
                  id="stageId"
                  defaultValue={formData.stageId}
                  onChange={(e) => setFormData({ ...formData, stageId: e.target.value })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <p className="text-xs text-muted-foreground">
                  Defaults to lead stage ({lead.stageId ?? 'not set'})
                </p>
              </div>
              <div className="space-y-2">
                <label htmlFor="ownerId" className="block text-sm font-medium text-foreground">
                  Owner / Assignee ID
                </label>
                <Input
                  id="ownerId"
                  defaultValue={formData.ownerId}
                  onChange={(e) => setFormData({ ...formData, ownerId: e.target.value })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <p className="text-xs text-muted-foreground">
                  Defaults to lead owner ({lead.ownerId ?? 'not set'})
                </p>
              </div>
              <div className="flex gap-2">
                <Button type="submit" className="flex-1" disabled={isLoading}>
                  {isLoading ? 'Converting...' : 'Convert to Opportunity'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push(`/crm/leads/${leadId}`)}
                  disabled={isLoading}
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
