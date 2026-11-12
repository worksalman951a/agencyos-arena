/**
 * Portal notifications: the client's own in-app notifications, with mark-all-read.
 */

import { MarkAllReadButton } from '@/components/portal/mark-all-read-button';
import { listPortalNotifications } from '@/lib/services/portal/portal-workspace-service';
import { loadPortalPageData } from '@/lib/portal/page-data';

export const dynamic = 'force-dynamic';

export default async function PortalNotificationsPage() {
  const result = await loadPortalPageData(() => listPortalNotifications());

  if (!result.ok) {
    return (
      <div role="alert" className="rounded-md border p-4 text-sm">
        Notifications are not available for this account right now.
      </div>
    );
  }

  const notifications = result.data;
  const unread = notifications.filter((notification) => !notification.read).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Notifications</h2>
        {unread > 0 ? <MarkAllReadButton /> : null}
      </div>
      {notifications.length === 0 ? (
        <p className="text-sm text-muted-foreground">You have no notifications.</p>
      ) : (
        <ul className="space-y-2" data-testid="portal-notifications">
          {notifications.map((notification) => {
            const message =
              typeof notification.payload?.message === 'string'
                ? notification.payload.message
                : notification.type;
            return (
              <li
                key={notification.id}
                className={`rounded-md border p-3 text-sm ${notification.read ? 'bg-background' : 'bg-muted/50'}`}
              >
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {notification.type}
                </p>
                <p className="mt-1">{message}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
