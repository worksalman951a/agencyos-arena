'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

const CHANNEL_LABELS: Record<string, string> = {
  in_app: 'In-app notification centre',
  email: 'E-mail (queued, delivery not enabled yet)',
};

export function NotificationPreferencesForm({
  initialChannels,
  initialMutedTypes,
}: {
  initialChannels: Record<string, boolean>;
  initialMutedTypes: string[];
}) {
  const router = useRouter();
  const [channels, setChannels] = React.useState<Record<string, boolean>>(initialChannels);
  const [muteWorkflow, setMuteWorkflow] = React.useState(initialMutedTypes.includes('workflow'));
  const [saving, setSaving] = React.useState(false);

  async function save() {
    setSaving(true);
    try {
      const mutedTypes = muteWorkflow ? ['workflow'] : [];
      const res = await fetch('/api/v1/automation/preferences', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ channels, mutedTypes }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? 'Could not save preferences');
        return;
      }
      toast.success('Preferences saved');
      router.refresh();
    } catch {
      toast.error('Network error, please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {Object.keys(CHANNEL_LABELS).map((channel) => (
        <label key={channel} className="flex items-center justify-between gap-4 text-sm">
          <span>{CHANNEL_LABELS[channel]}</span>
          <input
            type="checkbox"
            checked={channels[channel] ?? false}
            onChange={(event) =>
              setChannels((current) => ({ ...current, [channel]: event.target.checked }))
            }
            className="h-4 w-4"
          />
        </label>
      ))}

      <label className="flex items-center justify-between gap-4 text-sm border-t pt-4">
        <span>Mute workflow automation notifications</span>
        <input
          type="checkbox"
          checked={muteWorkflow}
          onChange={(event) => setMuteWorkflow(event.target.checked)}
          className="h-4 w-4"
        />
      </label>

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium disabled:opacity-50 hover:bg-accent/90"
      >
        {saving ? 'Saving…' : 'Save preferences'}
      </button>
    </div>
  );
}
