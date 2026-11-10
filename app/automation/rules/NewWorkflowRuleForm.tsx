'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import {
  WORKFLOW_ACTION_TYPES,
  WORKFLOW_OPERATORS,
  WORKFLOW_TRIGGERS,
} from '@/lib/automation/rules';

/**
 * Create-a-workflow-rule form.
 *
 * The previous version posted free-form JSON and the API accepted whatever it
 * contained, so a rule could be saved that would never fire. The form now only
 * offers the triggers and action types the executor implements, and the server
 * validates the same vocabulary (`workflowRuleCreateSchema`) — the form is a
 * convenience, not the guarantee.
 */
export function NewWorkflowRuleForm() {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError(null);

    const field = String(data.get('conditionField') ?? '').trim();
    const operator = String(data.get('conditionOperator') ?? '');
    const value = String(data.get('conditionValue') ?? '').trim();

    const payload = {
      name: String(data.get('name') ?? '').trim(),
      trigger: String(data.get('trigger') ?? ''),
      conditions: field ? { mode: 'all', all: [{ field, operator, value }] } : {},
      actions: {
        list: [
          {
            type: String(data.get('actionType') ?? 'log'),
            title: String(data.get('actionTitle') ?? '').trim() || undefined,
            message: String(data.get('actionMessage') ?? '').trim() || undefined,
            userId: String(data.get('actionUserId') ?? '').trim() || undefined,
            roleName: String(data.get('actionRoleName') ?? '').trim() || undefined,
          },
        ],
      },
      enabled: data.get('enabled') === 'on',
    };

    // Strip undefined so the strict server schema does not see unknown keys.
    payload.actions.list = payload.actions.list.map((action) => {
      const cleaned: Record<string, unknown> = { type: action.type };
      for (const [key, value2] of Object.entries(action)) {
        if (key !== 'type' && value2 !== undefined && value2 !== '') cleaned[key] = value2;
      }
      return cleaned;
    }) as typeof payload.actions.list;

    setPending(true);
    try {
      const res = await fetch('/api/v1/automation/workflows', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });

      const body = (await res.json().catch(() => ({}))) as { error?: string; issues?: unknown };

      if (!res.ok) {
        const detail =
          body.error === 'Invalid request body' && Array.isArray(body.issues)
            ? (body.issues as Array<{ message?: string; path?: unknown[] }>)
                .map((issue) => `${(issue.path ?? []).join('.')}: ${issue.message}`)
                .join('; ')
            : (body.error ?? 'Could not create the rule');
        setError(detail);
        toast.error('Rule not created');
        return;
      }

      toast.success('Workflow rule created');
      form.reset();
      router.refresh();
    } catch {
      setError('Network error, please try again.');
    } finally {
      setPending(false);
    }
  }

  const inputClass = 'w-full border border-input rounded-md px-3 py-2 text-sm';
  const labelClass = 'text-xs font-medium text-muted-foreground';

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="new-rule-form">
      {error ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={labelClass} htmlFor="name">
            Name
          </label>
          <input
            id="name"
            name="name"
            required
            className={inputClass}
            placeholder="Notify owner on status change"
          />
        </div>
        <div className="space-y-1">
          <label className={labelClass} htmlFor="trigger">
            Trigger
          </label>
          <select
            id="trigger"
            name="trigger"
            className={`${inputClass} bg-background`}
            defaultValue="record.created"
          >
            {WORKFLOW_TRIGGERS.map((trigger) => (
              <option key={trigger} value={trigger}>
                {trigger}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="rounded-md border p-3 space-y-3">
        <legend className="text-xs font-medium text-muted-foreground px-1">
          Condition (optional — leave the field empty to always match)
        </legend>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className={labelClass} htmlFor="conditionField">
              Field
            </label>
            <input
              id="conditionField"
              name="conditionField"
              className={inputClass}
              placeholder="status"
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass} htmlFor="conditionOperator">
              Operator
            </label>
            <select
              id="conditionOperator"
              name="conditionOperator"
              className={`${inputClass} bg-background`}
              defaultValue="eq"
            >
              {WORKFLOW_OPERATORS.map((operator) => (
                <option key={operator} value={operator}>
                  {operator}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelClass} htmlFor="conditionValue">
              Value
            </label>
            <input
              id="conditionValue"
              name="conditionValue"
              className={inputClass}
              placeholder="won"
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-md border p-3 space-y-3">
        <legend className="text-xs font-medium text-muted-foreground px-1">Action</legend>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className={labelClass} htmlFor="actionType">
              Type
            </label>
            <select
              id="actionType"
              name="actionType"
              className={`${inputClass} bg-background`}
              defaultValue="log"
            >
              {WORKFLOW_ACTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelClass} htmlFor="actionTitle">
              Title
            </label>
            <input
              id="actionTitle"
              name="actionTitle"
              className={inputClass}
              placeholder="Deal closed"
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass} htmlFor="actionMessage">
              Message / status / user id
            </label>
            <input id="actionMessage" name="actionMessage" className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className={labelClass} htmlFor="actionUserId">
              Target user id (notify_user / assign_record_owner)
            </label>
            <input
              id="actionUserId"
              name="actionUserId"
              className={inputClass}
              placeholder="$.ownerId or a user id"
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass} htmlFor="actionRoleName">
              Role name (notify_role)
            </label>
            <input
              id="actionRoleName"
              name="actionRoleName"
              className={inputClass}
              placeholder="Manager"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Email and webhook actions are not available: no SMTP/webhook infrastructure exists in this
          phase, so they are rejected instead of silently doing nothing.
        </p>
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked className="h-4 w-4" />
        Enabled
      </label>

      <button
        type="submit"
        disabled={pending}
        className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium disabled:opacity-50 hover:bg-accent/90"
      >
        {pending ? 'Creating…' : 'Create rule'}
      </button>
    </form>
  );
}
