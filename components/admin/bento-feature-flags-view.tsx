'use client';

import * as React from 'react';
import Link from 'next/link';
import { Flag } from 'lucide-react';
import {
  Panel,
  EmptyState,
  KeyValueRow,
  StatusPill,
  StatStrip,
} from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import '@/components/crm/bento-contacts.css';

export interface FeatureFlagItem {
  id: string;
  flagKey: string;
  description: string | null;
  enabled: boolean;
  createdAt: Date;
}

interface BentoFeatureFlagsViewProps {
  flags: FeatureFlagItem[];
}

export function BentoFeatureFlagsView({ flags }: BentoFeatureFlagsViewProps) {
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const activeFlag = flags[Math.min(selectedIdx, Math.max(0, flags.length - 1))] ?? null;

  const totalFlags = flags.length;
  const enabledCount = flags.filter((f) => f.enabled).length;
  const disabledCount = flags.filter((f) => !f.enabled).length;

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Administration</span>
            <span>/</span>
            <span>Feature Management & Rollout</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">Feature Flags</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Organization-scoped feature toggles for controlled module activation and dark launches
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/settings">Workspace Settings</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/health">System Health</Link>
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Total Feature Flags',
            value: String(totalFlags),
            note: 'registered organization toggles',
          },
          {
            label: 'Active & Enabled',
            value: String(enabledCount),
            note: 'features unlocked in workspace',
            tone: 'ok',
          },
          {
            label: 'Disabled / Staged',
            value: String(disabledCount),
            note: 'dark launch or restricted',
          },
        ]}
      />

      {/* ── Flags Grid & Inspector ───────────────────────────────────── */}
      {flags.length === 0 ? (
        <Panel pad>
          <EmptyState
            title="No feature flags configured"
            sub="No organization-specific feature flag overrides are present for this workspace."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2 min-w-0">
            <Panel title={`Feature Flags Registry (${flags.length})`}>
              <div className="bento-sales-table-head">
                <span>Flag Key & Identifier</span>
                <span>Status</span>
                <span className="text-right">Created</span>
                <span className="text-right">Action</span>
              </div>

              <div className="divide-y divide-border">
                {flags.map((flag, idx) => {
                  const isSelected = activeFlag?.id === flag.id;
                  return (
                    <div
                      key={flag.id}
                      onClick={() => setSelectedIdx(idx)}
                      className={`bento-sales-row cursor-pointer transition-colors ${
                        isSelected ? 'bg-accent/10 border-l-2 border-accent' : 'hover:bg-muted/40'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Flag className="h-3.5 w-3.5 text-accent shrink-0" />
                          <span className="text-xs font-mono font-semibold text-foreground truncate">
                            {flag.flagKey}
                          </span>
                        </div>
                        {flag.description && (
                          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                            {flag.description}
                          </div>
                        )}
                      </div>

                      <div>
                        {flag.enabled ? (
                          <StatusPill tone="ok">Enabled</StatusPill>
                        ) : (
                          <StatusPill tone="neutral">Disabled</StatusPill>
                        )}
                      </div>

                      <div className="text-right text-xs text-muted-foreground">
                        {new Date(flag.createdAt).toLocaleDateString()}
                      </div>

                      <div className="text-right">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/admin/feature-flags/${flag.id}`}>Edit</Link>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>

          {/* Feature Flag Inspector Drawer */}
          <div className="lg:col-span-1 min-w-0">
            {activeFlag ? (
              <Panel
                title="Flag Inspector"
                action={
                  activeFlag.enabled ? (
                    <StatusPill tone="ok">Enabled</StatusPill>
                  ) : (
                    <StatusPill tone="neutral">Disabled</StatusPill>
                  )
                }
              >
                <div className="p-4 space-y-4">
                  <div className="space-y-1">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Flag Key
                    </div>
                    <div className="text-xs font-mono font-bold text-foreground break-all">
                      {activeFlag.flagKey}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Description
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {activeFlag.description || 'No description provided for this flag.'}
                    </div>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-border">
                    <KeyValueRow
                      label="Current State"
                      value={activeFlag.enabled ? 'Enabled in Organization' : 'Disabled'}
                    />
                    <KeyValueRow
                      label="Created Timestamp"
                      value={new Date(activeFlag.createdAt).toLocaleString()}
                    />
                    <KeyValueRow label="Evaluation Scope" value="Organization Tenant Isolated" />
                  </div>

                  <div className="pt-3 border-t border-border">
                    <Button asChild className="w-full" size="sm">
                      <Link href={`/admin/feature-flags/${activeFlag.id}`}>
                        Configure Flag Settings
                      </Link>
                    </Button>
                  </div>
                </div>
              </Panel>
            ) : (
              <Panel pad>
                <EmptyState
                  title="No flag selected"
                  sub="Select a flag from the registry to inspect details."
                />
              </Panel>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
