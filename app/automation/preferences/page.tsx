/**
 * AgencyOS Notification Preferences page.
 *
 * Delivery preferences are consulted before a notification is created, so the
 * switches on this page change what actually arrives — they are not a display
 * of intent.
 */

import { getNotificationPreferences } from '@/lib/services/automation/notification-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { NotificationPreferencesForm } from './NotificationPreferencesForm';

export default async function PreferencesPage() {
  const result = await loadPageData(() => getNotificationPreferences());
  if (!result.ok) return <PageStateNotice reason={result.reason} />;

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

      <div className="rounded-md border bg-background p-6 max-w-2xl">
        <NotificationPreferencesForm
          initialChannels={result.data.channels}
          initialMutedTypes={result.data.mutedTypes}
        />
      </div>
    </div>
  );
}
