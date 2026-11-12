'use client';

import * as React from 'react';
import Link from 'next/link';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoNotificationsView } from '@/components/automation/bento-notifications-view';
import { MarkNotificationReadButton } from './MarkNotificationReadButton';
import { MarkAllReadButton } from './MarkAllReadButton';
import type { NotificationResponse } from '@/lib/services/automation/notification-service';

interface NotificationsClientProps {
  notifications: NotificationResponse[];
}

export function NotificationsClient({ notifications }: NotificationsClientProps) {
  const isBento = useBentoShell();

  if (isBento) {
    return <BentoNotificationsView notifications={notifications} />;
  }

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
            {notifications.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-8 text-muted-foreground">
                  No notifications found.
                </td>
              </tr>
            ) : (
              notifications.map((n) => (
                <tr
                  key={n.id}
                  className={`border-b border-border hover:bg-muted/50 ${n.read ? 'opacity-60' : ''}`}
                >
                  <td className="py-4 text-sm font-medium">
                    {n.type}
                    {n.payload && (
                      <span className="block text-xs text-muted-foreground font-normal">
                        {String(n.payload.message ?? n.payload.title ?? '')}
                      </span>
                    )}
                  </td>
                  <td className="py-4 text-sm text-muted-foreground font-mono">{n.channel}</td>
                  <td className="py-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-none ${
                        n.read ? 'bg-muted text-muted-foreground' : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {n.read ? 'Read' : 'Unread'}
                    </span>
                  </td>
                  <td className="py-4 text-right text-sm text-muted-foreground">
                    {new Date(n.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-4 text-right">
                    {!n.read && <MarkNotificationReadButton notificationId={n.id} />}
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
