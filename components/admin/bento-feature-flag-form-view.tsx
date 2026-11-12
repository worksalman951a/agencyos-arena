'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Flag, AlertTriangle, CheckCircle2, Shield } from 'lucide-react';
import { Panel, StatStrip, StatusPill, KeyValueRow } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import '@/components/crm/bento-contacts.css';

interface BentoFeatureFlagFormViewProps {
  flagId: string;
  flagKey: string;
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  description: string;
  setDescription: (desc: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  error: string | null;
}

export function BentoFeatureFlagFormView({
  flagKey,
  enabled,
  setEnabled,
  description,
  setDescription,
  onSubmit,
  isLoading,
  error,
}: Omit<BentoFeatureFlagFormViewProps, 'flagId'>) {
  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-8 w-8" title="Cancel and return">
            <Link href="/admin/feature-flags">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Link href="/admin/feature-flags" className="hover:underline">
                Administration
              </Link>
              <span>/</span>
              <Link href="/admin/feature-flags" className="hover:underline">
                Feature Flags
              </Link>
              <span>/</span>
              <span>Edit Flag</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              Edit Feature Flag:{' '}
              <span className="font-mono text-accent">{flagKey || 'Loading…'}</span>
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="h-8 text-xs">
            <Link href="/admin/feature-flags">Cancel</Link>
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isLoading}
            onClick={onSubmit}
            className="h-8 text-xs bg-accent text-accent-foreground hover:bg-accent/90"
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {isLoading ? 'Saving Changes…' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3 text-xs bg-destructive/10 text-destructive rounded-md border border-destructive/20 flex items-center gap-2"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Flag Identifier',
            value: flagKey || '—',
            note: 'immutable key reference',
          },
          {
            label: 'Current Status',
            value: enabled ? 'ACTIVE & ENABLED' : 'RESTRICTED / DISABLED',
            note: enabled ? 'Unlocked across organization' : 'Feature staged or dark-launched',
            tone: enabled ? 'ok' : undefined,
          },
          {
            label: 'Evaluation Scope',
            value: 'Organization Isolated',
            note: 'Specific to this workspace tenant',
          },
          {
            label: 'Authority Level',
            value: 'Server Authoritative',
            note: 'Cannot be bypassed via client-side cookie',
            tone: 'ok',
          },
        ]}
      />

      {/* ── Form Body & Inspection Sidebar ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-6">
          <Panel title="Configuration Parameters">
            <form onSubmit={onSubmit} className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label
                  htmlFor="flag-key"
                  className="font-semibold text-foreground flex items-center gap-1.5"
                >
                  <Flag className="h-3.5 w-3.5 text-accent" />
                  Flag Key (Read-Only)
                </label>
                <Input
                  id="flag-key"
                  value={flagKey}
                  disabled
                  className="h-8 text-xs font-mono bg-muted text-muted-foreground"
                />
                <p className="text-[11px] text-muted-foreground">
                  The flag key is used by server guards and application code to check feature
                  availability.
                </p>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-border">
                <label className="font-semibold text-foreground flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabled}
                    disabled={isLoading}
                    onChange={(e) => setEnabled(e.target.checked)}
                    className="rounded border-input text-accent bg-background"
                  />
                  <span>Enable feature flag for this organization</span>
                </label>
                <p className="text-[11px] text-muted-foreground">
                  When enabled, all users in this organization with appropriate permissions can
                  access this feature.
                </p>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-border">
                <label htmlFor="flag-desc" className="font-semibold text-foreground">
                  Description & Context
                </label>
                <textarea
                  id="flag-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={isLoading}
                  rows={3}
                  placeholder="Describe the feature purpose, rollout stage, or limitations..."
                  className="w-full border border-input rounded-md px-3 py-2 text-xs bg-background text-foreground"
                />
              </div>

              <div className="pt-3 border-t border-border flex justify-end gap-2">
                <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                  <Link href="/admin/feature-flags">Cancel</Link>
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isLoading}
                  className="h-8 text-xs bg-accent text-accent-foreground hover:bg-accent/90"
                >
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                  {isLoading ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </form>
          </Panel>
        </div>

        {/* Sidebar Info & Safety Audit */}
        <div className="space-y-6">
          <Panel title="Security & Deployment">
            <div className="p-1 space-y-3 text-xs">
              <div className="space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block">
                  Activation State
                </span>
                <div className="flex items-center gap-2">
                  <StatusPill tone={enabled ? 'ok' : 'neutral'}>
                    {enabled ? 'Enabled' : 'Disabled'}
                  </StatusPill>
                  <span className="text-muted-foreground font-mono text-[11px]">{flagKey}</span>
                </div>
              </div>

              <div className="border-t border-border pt-2 space-y-2">
                <KeyValueRow label="Scope" value="Tenant Organization" />
                <KeyValueRow label="Persistence" value="PostgreSQL FeatureFlag Table" />
              </div>

              <div className="border-t border-border pt-3 space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Shield className="h-3 w-3 text-accent" />
                  Security Guardrails
                </div>
                <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-accent shrink-0 mt-0.5" />
                  <span>Updates require server-level feature_flag.update permission.</span>
                </div>
                <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-accent shrink-0 mt-0.5" />
                  <span>Strict organization boundary isolation prevents cross-tenant leaks.</span>
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
