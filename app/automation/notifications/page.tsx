/**
 * AgencyOS Notifications page.
 * Lists in-app notifications for the current user.
 */

import Link from 'next/link';
import { listNotifications } from '@/lib/services/automation/notification-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { MarkNotificationReadButton } from './MarkNotificationReadButton';
import { MarkAllReadButton } from './MarkAllReadButton';

export default async function NotificationsPage() {
  const result = await loadPageData(() => listNotifications());

  if (!result.ok) {
    return <PageStateNotice reason={result.reason} />;
  }

  const notifications = result.data as Array<{
    id: string;
    type: string;
    channel: string;
    read: boolean;
    payload: Record<string, unknown> | null;
    createdAt: Date;
  }>;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Notifications</h1>
        <div className="flex items-center gap-2">
          <MarkAllReadButton disabled={notifications.every((n) => n.read)} />
          <Link
            href="/automation/preferences"
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Preferences
          </Link>
          <Link
            href="/automation/rules"
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Workflow Rules
          </Link>
        </div>
      </div>

      <div className="rounded-md border bg-background p-6 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Inbox</h2>
          <p className="text-sm text-muted-foreground" data-testid="unread-count">
            {notifications.filter((n) => !n.read).length} unread of {notifications.length}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">Type</th>
              <th className="pb-3 font-medium">Channel</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium text-right">Created</th>
              <th className="pb-3 font-medium w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(
              notifications as Array<{
                id: string;
                type: string;
                channel: string;
                read: boolean;
                payload: Record<string, unknown> | null;
                createdAt: Date;
              }>
            ).length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-8 text-muted-foreground">
                  No notifications found.
                </td>
              </tr>
            ) : (
              (
                notifications as Array<{
                  id: string;
                  type: string;
                  channel: string;
                  read: boolean;
                  payload: Record<string, unknown> | null;
                  createdAt: Date;
                }>
              ).map((n) => (
                <tr
                  key={n.id}
                  className={`border-b border-border hover:bg-muted/50 ${n.read ? 'opacity-60' : ''}`}
                >
                  <td className="py-4 font-medium">{n.type}</td>
                  <td className="py-4 text-sm text-muted-foreground">{n.channel}</td>
                  <td className="py-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-none ${
                        n.read ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {n.read ? 'Read' : 'Unread'}
                    </span>
                  </td>
                  <td className="py-4 text-right text-sm text-muted-foreground">
                    {new Date(n.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-4 text-right">
                    {!n.read ? (
                      <MarkNotificationReadButton notificationId={n.id} />
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
