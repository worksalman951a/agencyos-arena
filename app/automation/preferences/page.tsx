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
import { NotificationPreferencesClient } from './notification-preferences-client';

export default async function PreferencesPage() {
  const result = await loadPageData(() => getNotificationPreferences());
  if (!result.ok) return <PageStateNotice reason={result.reason} />;

  return <NotificationPreferencesClient preferences={result.data} />;
}
