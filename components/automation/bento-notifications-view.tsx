'use client';

import * as React from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import {
  Panel,
  EmptyState,
  KeyValueRow,
  StatusPill,
  StatStrip,
} from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { MarkNotificationReadButton } from '@/app/automation/notifications/MarkNotificationReadButton';
import { MarkAllReadButton } from '@/app/automation/notifications/MarkAllReadButton';
import type { NotificationResponse } from '@/lib/services/automation/notification-service';
import '@/components/crm/bento-contacts.css';

interface BentoNotificationsViewProps {
  notifications: NotificationResponse[];
}

export function BentoNotificationsView({ notifications }: BentoNotificationsViewProps) {
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const [filterRead, setFilterRead] = React.useState<'all' | 'unread' | 'read'>('all');

  const filteredNotifications = React.useMemo(() => {
    if (filterRead === 'unread') return notifications.filter((n) => !n.read);
    if (filterRead === 'read') return notifications.filter((n) => n.read);
    return notifications;
  }, [notifications, filterRead]);

  const activeNotification =
    filteredNotifications[Math.min(selectedIdx, Math.max(0, filteredNotifications.length - 1))] ??
    null;

  const totalCount = notifications.length;
  const unreadCount = notifications.filter((n) => !n.read).length;
  const readCount = totalCount - unreadCount;

  // Extract link or destination from payload if present
  const getDestinationLink = (payload: Record<string, unknown> | null): string | null => {
    if (!payload) return null;
    if (typeof payload.link === 'string' && payload.link.startsWith('/')) return payload.link;
    if (typeof payload.url === 'string' && payload.url.startsWith('/')) return payload.url;
    if (typeof payload.recordType === 'string' && typeof payload.recordId === 'string') {
      const type = payload.recordType.toLowerCase();
      if (type === 'lead') return `/crm/leads/${payload.recordId}`;
      if (type === 'project') return `/projects/${payload.recordId}`;
      if (type === 'invoice') return `/finance/invoices/${payload.recordId}`;
      if (type === 'account') return `/crm/accounts/${payload.recordId}`;
      if (type === 'contact') return `/crm/contacts/${payload.recordId}`;
    }
    return null;
  };

  const destinationLink = activeNotification
    ? getDestinationLink(activeNotification.payload)
    : null;

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Automation</span>
            <span>/</span>
            <span>Alerts & Activity Stream</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">
            Notification Center
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Personal notifications, assignment alerts, and workflow execution notices
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <MarkAllReadButton disabled={unreadCount === 0} />
          <Button asChild variant="outline" size="sm">
            <Link href="/automation/preferences">Preferences</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/automation/rules">Workflow Rules</Link>
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Total Notifications',
            value: String(totalCount),
            note: 'historical messages delivered',
          },
          {
            label: 'Unread Messages',
            value: String(unreadCount),
            note: 'require attention or acknowledgment',
            tone: unreadCount > 0 ? 'warn' : 'ok',
          },
          {
            label: 'Read Notifications',
            value: String(readCount),
            note: 'cleared notifications',
          },
        ]}
      />

      {/* ── Filter Controls ─────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <Button
          variant={filterRead === 'all' ? 'default' : 'outline'}
          size="sm"
          className="h-8 text-xs"
          onClick={() => {
            setFilterRead('all');
            setSelectedIdx(0);
          }}
        >
          All ({totalCount})
        </Button>
        <Button
          variant={filterRead === 'unread' ? 'default' : 'outline'}
          size="sm"
          className="h-8 text-xs"
          onClick={() => {
            setFilterRead('unread');
            setSelectedIdx(0);
          }}
        >
          Unread ({unreadCount})
        </Button>
        <Button
          variant={filterRead === 'read' ? 'default' : 'outline'}
          size="sm"
          className="h-8 text-xs"
          onClick={() => {
            setFilterRead('read');
            setSelectedIdx(0);
          }}
        >
          Read ({readCount})
        </Button>
      </div>

      {/* ── Notifications Grid & Inspector ──────────────────────────── */}
      {filteredNotifications.length === 0 ? (
        <Panel pad>
          <EmptyState
            title={
              filterRead === 'unread' ? 'No unread notifications' : 'No notifications in your inbox'
            }
            sub="System notifications and workflow alerts will appear here as activity occurs."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2 min-w-0">
            <Panel title={`Notification Stream (${filteredNotifications.length})`}>
              <div className="bento-sales-table-head">
                <span>Message & Type</span>
                <span>Channel</span>
                <span className="text-right">Time</span>
                <span className="text-right">Status</span>
                <span className="text-right">Action</span>
              </div>

              <div className="divide-y divide-border/60">
                {filteredNotifications.map((notif, idx) => {
                  const isSelected = activeNotification?.id === notif.id;
                  const title =
                    typeof notif.payload?.title === 'string'
                      ? notif.payload.title
                      : typeof notif.payload?.message === 'string'
                        ? notif.payload.message
                        : notif.type;

                  return (
                    <div
                      key={notif.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedIdx(idx)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedIdx(idx);
                        }
                      }}
                      data-active={isSelected ? 'true' : undefined}
                      className={`bento-sales-table-row focus:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer ${
                        notif.read ? 'opacity-60' : 'bg-accent/5'
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="font-semibold text-foreground text-xs truncate flex items-center gap-1.5">
                          {!notif.read && (
                            <span className="h-1.5 w-1.5 rounded-full bg-accent shrink-0" />
                          )}
                          <span className="truncate">{title}</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 truncate font-mono">
                          {notif.type}
                        </div>
                      </div>

                      <div className="min-w-0 pr-2 text-xs font-mono text-muted-foreground truncate">
                        {notif.channel}
                      </div>

                      <div className="text-xs text-muted-foreground text-right font-mono">
                        {new Date(notif.createdAt).toLocaleDateString()}
                      </div>

                      <div className="text-right">
                        <StatusPill tone={notif.read ? undefined : 'ok'}>
                          {notif.read ? 'Read' : 'New'}
                        </StatusPill>
                      </div>

                      <div className="text-right" onClick={(e) => e.stopPropagation()}>
                        {!notif.read ? (
                          <MarkNotificationReadButton notificationId={notif.id} />
                        ) : (
                          <span className="text-xs text-muted-foreground font-mono">—</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>

          <div className="min-w-0">
            {activeNotification ? (
              <Panel
                title="Notification Details"
                action={
                  !activeNotification.read ? (
                    <MarkNotificationReadButton notificationId={activeNotification.id} />
                  ) : undefined
                }
              >
                <div className="space-y-4 text-xs">
                  <div>
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                      Alert Subject
                    </span>
                    <h3 className="text-sm font-bold text-foreground mt-0.5">
                      {typeof activeNotification.payload?.title === 'string'
                        ? activeNotification.payload.title
                        : activeNotification.type}
                    </h3>
                    {typeof activeNotification.payload?.message === 'string' && (
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        {activeNotification.payload.message}
                      </p>
                    )}
                  </div>

                  <div className="border-t border-border pt-3 space-y-2.5">
                    <KeyValueRow
                      label="Delivery Status"
                      value={
                        <StatusPill tone={activeNotification.read ? undefined : 'ok'}>
                          {activeNotification.read ? 'Read' : 'Unread'}
                        </StatusPill>
                      }
                    />
                    <KeyValueRow
                      label="Event Type"
                      value={<code className="font-mono text-xs">{activeNotification.type}</code>}
                    />
                    <KeyValueRow label="Channel" value={activeNotification.channel} />
                    <KeyValueRow
                      label="Received At"
                      value={new Date(activeNotification.createdAt).toLocaleString()}
                    />
                  </div>

                  {destinationLink && (
                    <div className="border-t border-border pt-3">
                      <Button asChild className="w-full bg-accent text-accent-foreground" size="sm">
                        <Link href={destinationLink}>
                          View Related Record <ExternalLink size={12} className="ml-1.5" />
                        </Link>
                      </Button>
                    </div>
                  )}

                  {activeNotification.payload && (
                    <div className="border-t border-border pt-3">
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                        Notification Metadata:
                      </span>
                      <pre className="text-xs overflow-x-auto bg-muted/40 p-2.5 rounded font-mono border border-border max-h-48">
                        {JSON.stringify(activeNotification.payload, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </Panel>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
