'use client';

import * as React from 'react';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoNotificationPreferencesView } from '@/components/automation/bento-notification-preferences-view';
import { NotificationPreferencesForm } from './NotificationPreferencesForm';
import type { NotificationPreferenceResponse } from '@/lib/services/automation/notification-service';

interface NotificationPreferencesClientProps {
  preferences: NotificationPreferenceResponse;
}

export function NotificationPreferencesClient({ preferences }: NotificationPreferencesClientProps) {
  const isBento = useBentoShell();

  const formNode = (
    <NotificationPreferencesForm
      initialChannels={preferences.channels}
      initialMutedTypes={preferences.mutedTypes}
    />
  );

  if (isBento) {
    return <BentoNotificationPreferencesView preferences={preferences} formNode={formNode} />;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Notification Preferences</h1>
          <p className="text-sm text-muted-foreground">
            Choose which channels you receive notifications on.
          </p>
        </div>
      </div>

      <div className="rounded-md border bg-background p-6 max-w-2xl">{formNode}</div>
    </div>
  );
}
