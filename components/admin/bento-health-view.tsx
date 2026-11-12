'use client';

import * as React from 'react';
import Link from 'next/link';
import { Activity, AlertTriangle, Database } from 'lucide-react';
import { Panel, KeyValueRow, StatusPill, StatStrip } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import '@/components/crm/bento-contacts.css';

export interface HealthServiceStatus {
  name: string;
  status: 'healthy' | 'unhealthy';
  latency?: number;
}

interface BentoHealthViewProps {
  services: HealthServiceStatus[];
  allHealthy: boolean;
  dbError?: string;
  checkedAt: string;
}

export function BentoHealthView({
  services,
  allHealthy,
  dbError,
  checkedAt,
}: BentoHealthViewProps) {
  const dbLatency = services.find((s) => s.name === 'database')?.latency;

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Administration</span>
            <span>/</span>
            <span>Infrastructure Health & Telemetry</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">
            System Health & Diagnostics
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Monitor real-time database connectivity, service latencies, and platform operational
            status
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/audit-logs">Audit Logs</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/feature-flags">Feature Flags</Link>
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Overall Platform Status',
            value: allHealthy ? 'Operational' : 'Degraded',
            note: allHealthy
              ? 'All monitored subsystems responsive'
              : 'Active service degradation detected',
            tone: allHealthy ? 'ok' : 'danger',
          },
          {
            label: 'Database Latency',
            value: dbLatency !== undefined ? `${dbLatency}ms` : '—',
            note: 'Round-trip health check probe',
            tone: dbLatency !== undefined && dbLatency < 100 ? 'ok' : undefined,
          },
          {
            label: 'Diagnostic Check Time',
            value: checkedAt,
            note: 'In-process server verified',
          },
        ]}
      />

      {/* ── Error Banner ────────────────────────────────────────────── */}
      {dbError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div>
            <div className="font-semibold">Database Connection Error</div>
            <div className="mt-0.5">{dbError}</div>
          </div>
        </div>
      )}

      {/* ── Monitored Subsystems Table & Diagnostics ──────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 min-w-0">
          <Panel title="Monitored Infrastructure Components">
            <div className="bento-sales-table-head">
              <span>Service Component</span>
              <span>Health Status</span>
              <span className="text-right">Response Latency</span>
            </div>

            <div className="divide-y divide-border">
              {services.map((svc) => (
                <div key={svc.name} className="bento-sales-row">
                  <div className="flex items-center gap-2.5">
                    <Database className="h-4 w-4 text-accent shrink-0" />
                    <div>
                      <span className="text-xs font-semibold capitalize text-foreground">
                        {svc.name}
                      </span>
                      <div className="text-[10px] text-muted-foreground">
                        PostgreSQL Primary Cluster
                      </div>
                    </div>
                  </div>

                  <div>
                    {svc.status === 'healthy' ? (
                      <StatusPill tone="ok">Operational</StatusPill>
                    ) : (
                      <StatusPill tone="danger">Unhealthy</StatusPill>
                    )}
                  </div>

                  <div className="text-right text-xs font-mono text-muted-foreground">
                    {svc.latency !== undefined ? `${svc.latency}ms` : '—'}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* Diagnostic Notes Drawer */}
        <div className="lg:col-span-1 min-w-0">
          <Panel title="Telemetry Architecture">
            <div className="p-4 space-y-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-2 text-foreground font-semibold">
                <Activity className="h-4 w-4 text-accent" />
                <span>Probe Methodology</span>
              </div>
              <p>
                The health diagnostic performs an in-process verified roundtrip query against the
                Prisma database client and reports latency in milliseconds.
              </p>
              <div className="pt-2 border-t border-border space-y-1.5">
                <KeyValueRow label="Queue Worker" value="Deferred" />
                <KeyValueRow label="Blob Storage" value="Deferred" />
                <KeyValueRow label="Audit Integration" value="Active" />
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
