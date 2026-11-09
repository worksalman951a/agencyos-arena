'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/toast';

/**
 * Create-a-workflow-rule form.
 *
 * Previously this markup lived in a Server Component with an `onClick` handler
 * and `window.location.reload()`, which cannot work: Server Components cannot
 * receive event handlers. It is now a Client Component that posts to the
 * automation API and refreshes the server-rendered list.
 */
export function NewWorkflowRuleForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);

  function parseJsonField(raw: string, label: string): Record<string, unknown> | null {
    if (!raw.trim()) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        toast({
          title: `Invalid ${label}`,
          description: `${label} must be a JSON object.`,
          variant: 'destructive',
        });
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      toast({
        title: `Invalid ${label}`,
        description: `${label} is not valid JSON.`,
        variant: 'destructive',
      });
      return null;
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    const conditions = parseJsonField(String(formData.get('conditions') ?? ''), 'Conditions');
    if (conditions === null) return;
    const actions = parseJsonField(String(formData.get('actions') ?? ''), 'Actions');
    if (actions === null) return;

    setPending(true);
    try {
      const res = await fetch('/api/v1/automation/workflows', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          name: String(formData.get('name') ?? ''),
          trigger: String(formData.get('trigger') ?? ''),
          conditions,
          actions,
          enabled: formData.get('enabled') === 'on',
        }),
      });

      if (res.status === 401) {
        router.push('/login');
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast({
          title: 'Could not create rule',
          description: body.error ?? 'Please check the form and try again.',
          variant: 'destructive',
        });
        return;
      }

      toast({ title: 'Rule created' });
      formRef.current?.reset();
      router.refresh();
    } catch {
      toast({
        title: 'Could not create rule',
        description: 'Network error.',
        variant: 'destructive',
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="workflow-name">
          Rule Name
        </label>
        <input
          id="workflow-name"
          type="text"
          name="name"
          placeholder="e.g. Overdue Invoice Reminder"
          className="w-full border border-input rounded-md px-3 py-2 text-sm"
          required
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="workflow-trigger">
          Trigger
        </label>
        <input
          id="workflow-trigger"
          type="text"
          name="trigger"
          placeholder="e.g. invoice.overdue"
          className="w-full border border-input rounded-md px-3 py-2 text-sm"
          required
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="workflow-conditions">
          Conditions (JSON)
        </label>
        <textarea
          id="workflow-conditions"
          name="conditions"
          rows={3}
          placeholder='{"field": "dueDate", "operator": "<", "value": "today"}'
          className="w-full border border-input rounded-md px-3 py-2 text-sm font-mono"
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="workflow-actions">
          Actions (JSON)
        </label>
        <textarea
          id="workflow-actions"
          name="actions"
          rows={3}
          placeholder='{"type": "send_email", "template": "overdue_reminder"}'
          className="w-full border border-input rounded-md px-3 py-2 text-sm font-mono"
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium flex items-center gap-2">
          Enabled
          <input
            type="checkbox"
            name="enabled"
            defaultChecked
            className="rounded border-input text-accent bg-background"
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
      >
        {pending ? 'Creating…' : 'Create Rule'}
      </button>
    </form>
  );
}
