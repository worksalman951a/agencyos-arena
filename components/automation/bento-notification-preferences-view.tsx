'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Panel, KeyValueRow, StatusPill, StatStrip } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import type { NotificationPreferenceResponse } from '@/lib/services/automation/notification-service';
import '@/components/crm/bento-contacts.css';

interface BentoNotificationPreferencesViewProps {
  preferences: NotificationPreferenceResponse;
  formNode: React.ReactNode;
}

export function BentoNotificationPreferencesView({
  preferences,
  formNode,
}: BentoNotificationPreferencesViewProps) {
  const channelCount = Object.keys(preferences.channels).length;
  const activeChannels = Object.values(preferences.channels).filter(Boolean).length;
  const mutedTypesCount = preferences.mutedTypes.length;

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm" className="h-8 px-2.5">
            <Link href="/automation/notifications" aria-label="Back to notifications">
              <ArrowLeft size={14} />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Automation</span>
              <span>/</span>
              <span>Notifications</span>
              <span>/</span>
              <span>Preferences</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              Notification Preferences
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="h-8 text-xs">
            <Link href="/automation/notifications">Notification Center</Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="h-8 text-xs">
            <Link href="/automation/rules">Workflow Rules</Link>
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Configured Channels',
            value: `${activeChannels} of ${channelCount}`,
            note: 'active notification mediums',
            tone: activeChannels > 0 ? 'ok' : undefined,
          },
          {
            label: 'Muted Categories',
            value: String(mutedTypesCount),
            note: mutedTypesCount > 0 ? 'muted workflow alerts' : 'all events unmuted',
            tone: mutedTypesCount > 0 ? 'warn' : 'ok',
          },
        ]}
      />

      {/* ── Configuration Form Panel ─────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
        <div className="md:col-span-2">
          <Panel title="Delivery Mediums & Topic Subscriptions">
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              Delivery preferences are consulted before any notification is generated. Modifying
              these switches directly governs what arrives in your inbox or connected delivery
              queues.
            </p>
            <div className="max-w-xl">{formNode}</div>
          </Panel>
        </div>

        <div>
          <Panel title="Delivery Information">
            <div className="space-y-4 text-xs">
              <div>
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                  Channel Matrix
                </span>
                <p className="text-muted-foreground mt-1 leading-relaxed">
                  In-app notifications are delivered synchronously upon trigger events. Email
                  channel delivery remains in queued state until SMTP integration is active.
                </p>
              </div>

              <div className="border-t border-border pt-3 space-y-2">
                <KeyValueRow
                  label="In-App Medium"
                  value={<StatusPill tone="ok">Supported</StatusPill>}
                />
                <KeyValueRow
                  label="Email Delivery"
                  value={<StatusPill tone="warn">Queued</StatusPill>}
                />
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
