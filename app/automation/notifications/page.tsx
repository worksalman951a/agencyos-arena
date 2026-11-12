/**
 * AgencyOS Notifications page.
 * Lists in-app notifications for the current user.
 */

import { listNotifications } from '@/lib/services/automation/notification-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { NotificationsClient } from './notifications-client';

export default async function NotificationsPage() {
  const result = await loadPageData(() => listNotifications());

  if (!result.ok) {
    return <PageStateNotice reason={result.reason} />;
  }

  const notifications = result.data;

  return <NotificationsClient notifications={notifications} />;
}
