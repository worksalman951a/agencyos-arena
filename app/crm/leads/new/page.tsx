'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRouter } from 'next/navigation';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoLeadFormView } from '@/components/crm/bento-lead-form-view';

export default function CreateLeadPage() {
  const isBento = useBentoShell();
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [duplicateWarning, setDuplicateWarning] = React.useState<{
    duplicateId: string;
    message: string;
  } | null>(null);

  const form = useForm<{
    contactId: string;
    accountId: string;
    source: string;
    status: string;
    priority: string;
    expectedValue: string;
    ownerId: string;
    pipelineId: string;
    stageId: string;
    notes: string;
  }>({
    defaultValues: {
      contactId: '',
      accountId: '',
      source: '',
      status: 'new',
      priority: 'medium',
      expectedValue: '',
      ownerId: '',
      pipelineId: '',
      stageId: '',
      notes: '',
    },
  });

  const [contactId, setContactId] = React.useState('');
  const [accountId, setAccountId] = React.useState('');
  const [source, setSource] = React.useState('');
  const [status, setStatus] = React.useState('new');
  const [priority, setPriority] = React.useState('medium');
  const [expectedValue, setExpectedValue] = React.useState('');
  const [ownerId, setOwnerId] = React.useState('');
  const [pipelineId, setPipelineId] = React.useState('');
  const [stageId, setStageId] = React.useState('');
  const [notes, setNotes] = React.useState('');

  async function submitPayload(override = false) {
    setError(null);
    setDuplicateWarning(null);
    setIsLoading(true);
    try {
      const url = override ? '/api/v1/crm/leads?overrideDuplicate=true' : '/api/v1/crm/leads';

      const payload = isBento
        ? {
            contactId: contactId || null,
            accountId: accountId || null,
            source: source,
            status: status,
            priority: priority,
            expectedValue: expectedValue || null,
            ownerId: ownerId || null,
            pipelineId: pipelineId || null,
            stageId: stageId || null,
            notes: notes || null,
          }
        : {
            contactId: form.getValues('contactId') || null,
            accountId: form.getValues('accountId') || null,
            source: form.getValues('source'),
            status: form.getValues('status'),
            priority: form.getValues('priority'),
            expectedValue: form.getValues('expectedValue') || null,
            ownerId: form.getValues('ownerId') || null,
            pipelineId: form.getValues('pipelineId') || null,
            stageId: form.getValues('stageId') || null,
            notes: form.getValues('notes') || null,
          };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (res.status === 409) {
        const errData = await res.json().catch(() => ({}));
        setDuplicateWarning({
          duplicateId: errData.duplicateId || '',
          message: errData.message || 'A duplicate lead already exists.',
        });
        return;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || 'Failed to create lead');
        return;
      }

      router.push('/crm/leads');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create lead');
    } finally {
      setIsLoading(false);
    }
  }

  function onSubmit(e?: React.FormEvent) {
    if (e?.preventDefault) e.preventDefault();
    void submitPayload(false);
  }

  function confirmOverride() {
    void submitPayload(true);
  }

  if (isBento) {
    return (
      <BentoLeadFormView
        mode="new"
        contactId={contactId}
        setContactId={setContactId}
        accountId={accountId}
        setAccountId={setAccountId}
        source={source}
        setSource={setSource}
        status={status}
        setStatus={setStatus}
        priority={priority}
        setPriority={setPriority}
        expectedValue={expectedValue}
        setExpectedValue={setExpectedValue}
        ownerId={ownerId}
        setOwnerId={setOwnerId}
        pipelineId={pipelineId}
        setPipelineId={setPipelineId}
        stageId={stageId}
        setStageId={setStageId}
        notes={notes}
        setNotes={setNotes}
        onSubmit={onSubmit}
        isLoading={isLoading}
        error={error}
        duplicateWarning={duplicateWarning}
        onConfirmOverride={confirmOverride}
      />
    );
  }

  // Legacy fallback view
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-2xl">New Lead</CardTitle>
          <CardDescription>Enter lead details to qualify a prospect</CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2 mb-4">
              <span>{error}</span>
            </div>
          )}
          {duplicateWarning && (
            <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-3 text-sm text-amber-700 dark:text-amber-300 mb-4 space-y-2">
              <p className="font-semibold">{duplicateWarning.message}</p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={confirmOverride}
                  disabled={isLoading}
                >
                  Save Anyway
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => router.push(`/crm/leads/${duplicateWarning.duplicateId}`)}
                >
                  View Existing
                </Button>
              </div>
            </div>
          )}
          <form onSubmit={form.handleSubmit(() => onSubmit())} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="source" className="block text-sm font-medium text-foreground">
                Source <span className="text-destructive">*</span>
              </label>
              <Input
                id="source"
                {...form.register('source', { required: 'Source is required' })}
                placeholder="e.g. Website, Referral, Cold Call"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="status" className="block text-sm font-medium text-foreground">
                Status
              </label>
              <select
                id="status"
                {...form.register('status')}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="qualified">Qualified</option>
                <option value="unqualified">Unqualified</option>
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="priority" className="block text-sm font-medium text-foreground">
                Priority
              </label>
              <select
                id="priority"
                {...form.register('priority')}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="expectedValue" className="block text-sm font-medium text-foreground">
                Expected Value
              </label>
              <Input
                id="expectedValue"
                type="number"
                step="0.01"
                {...form.register('expectedValue')}
                placeholder="e.g. 5000"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="contactId" className="block text-sm font-medium text-foreground">
                Contact ID (Optional)
              </label>
              <Input
                id="contactId"
                {...form.register('contactId')}
                placeholder="Existing contact CUID"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="accountId" className="block text-sm font-medium text-foreground">
                Account ID (Optional)
              </label>
              <Input
                id="accountId"
                {...form.register('accountId')}
                placeholder="Existing account CUID"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="ownerId" className="block text-sm font-medium text-foreground">
                Owner ID (Optional)
              </label>
              <Input id="ownerId" {...form.register('ownerId')} placeholder="Assigned User CUID" />
            </div>
            <div className="space-y-2">
              <label htmlFor="pipelineId" className="block text-sm font-medium text-foreground">
                Pipeline ID (Optional)
              </label>
              <Input
                id="pipelineId"
                {...form.register('pipelineId')}
                placeholder="Sales Pipeline CUID"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="stageId" className="block text-sm font-medium text-foreground">
                Stage ID (Optional)
              </label>
              <Input id="stageId" {...form.register('stageId')} placeholder="Pipeline Stage CUID" />
            </div>
            <div className="space-y-2">
              <label htmlFor="notes" className="block text-sm font-medium text-foreground">
                Notes
              </label>
              <textarea
                id="notes"
                {...form.register('notes')}
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Initial thoughts or requirements"
              />
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push('/crm/leads')}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? 'Creating...' : 'Create Lead'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
