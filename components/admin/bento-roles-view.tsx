'use client';

import * as React from 'react';
import Link from 'next/link';
import { Eye } from 'lucide-react';
import {
  Panel,
  EmptyState,
  KeyValueRow,
  StatusPill,
  StatStrip,
} from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import type { RoleResponse } from '@/lib/services/admin/role-service';
import '@/components/crm/bento-contacts.css';

interface BentoRolesViewProps {
  roles: RoleResponse[];
}

export function BentoRolesView({ roles }: BentoRolesViewProps) {
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const activeRole = roles[Math.min(selectedIdx, Math.max(0, roles.length - 1))] ?? null;

  const totalRoles = roles.length;
  const systemRoles = roles.filter((r) => r.isSystem).length;
  const customRoles = totalRoles - systemRoles;

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Administration</span>
            <span>/</span>
            <span>Security Governance</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">
            Roles & Granular Permissions
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure system-level definitions, custom access boundaries, and role assignments
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/users">Users Directory</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/audit-logs">Audit Log Trail</Link>
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Total Registered Roles',
            value: String(totalRoles),
            note: 'governance profiles active',
          },
          {
            label: 'System Roles',
            value: String(systemRoles),
            note: 'built-in immutable baselines',
          },
          {
            label: 'Custom Roles',
            value: String(customRoles),
            note: 'organization-specific scopes',
            tone: customRoles > 0 ? 'ok' : undefined,
          },
        ]}
      />

      {/* ── Roles Grid & Inspector ───────────────────────────────────── */}
      {roles.length === 0 ? (
        <Panel pad>
          <EmptyState
            title="No roles found"
            sub="System and custom roles will appear here once provisioned."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2 min-w-0">
            <Panel title={`Roles Register (${roles.length})`}>
              <div className="bento-sales-table-head">
                <span>Role Name</span>
                <span>Description</span>
                <span>Type</span>
                <span className="text-right">Permissions</span>
                <span className="text-right">Action</span>
              </div>

              <div className="divide-y divide-border/60">
                {roles.map((r, idx) => {
                  const isSelected = activeRole?.id === r.id;

                  return (
                    <div
                      key={r.id}
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
                      className="bento-sales-table-row focus:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="font-semibold text-foreground text-xs truncate">
                          {r.name}
                        </div>
                      </div>

                      <div className="min-w-0 pr-2 text-xs text-muted-foreground truncate">
                        {r.description || '—'}
                      </div>

                      <div className="min-w-0 pr-2">
                        <StatusPill tone={r.isSystem ? undefined : 'ok'}>
                          {r.isSystem ? 'System' : 'Custom'}
                        </StatusPill>
                      </div>

                      <div className="text-xs font-mono font-medium text-foreground text-right">
                        {r.permissions.length} code{r.permissions.length === 1 ? '' : 's'}
                      </div>

                      <div className="text-right" onClick={(e) => e.stopPropagation()}>
                        {!r.isSystem ? (
                          <Link
                            href={`/admin/roles/${r.id}`}
                            className="text-xs font-semibold text-accent hover:underline inline-flex items-center gap-1"
                          >
                            Edit
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground font-mono">Immutable</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>

          <div className="min-w-0">
            {activeRole ? (
              <Panel
                title="Role Inspector"
                action={
                  !activeRole.isSystem ? (
                    <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                      <Link href={`/admin/roles/${activeRole.id}`}>
                        Configure <Eye size={12} className="ml-1" />
                      </Link>
                    </Button>
                  ) : undefined
                }
              >
                <div className="space-y-4 text-xs">
                  <div>
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                      Role Scope
                    </span>
                    <h3 className="text-sm font-bold text-foreground mt-0.5">{activeRole.name}</h3>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {activeRole.description || 'No role description provided'}
                    </p>
                  </div>

                  <div className="border-t border-border pt-3 space-y-2.5">
                    <KeyValueRow
                      label="Classification"
                      value={
                        <StatusPill tone={activeRole.isSystem ? undefined : 'ok'}>
                          {activeRole.isSystem ? 'System Baseline' : 'Custom Organization Role'}
                        </StatusPill>
                      }
                    />
                    <KeyValueRow
                      label="Permitted Codes"
                      value={`${activeRole.permissions.length} granular capabilities`}
                    />
                    <KeyValueRow
                      label="Created"
                      value={new Date(activeRole.createdAt).toLocaleDateString()}
                    />
                  </div>

                  <div className="border-t border-border pt-3">
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-2">
                      Granted Permissions ({activeRole.permissions.length}):
                    </span>
                    <div className="flex flex-wrap gap-1 max-h-48 overflow-y-auto">
                      {activeRole.permissions.length === 0 ? (
                        <p className="text-muted-foreground italic">
                          No granular permissions assigned.
                        </p>
                      ) : (
                        activeRole.permissions.map((p) => (
                          <span
                            key={p.code}
                            className="bg-muted px-2 py-0.5 rounded text-[11px] font-mono text-foreground"
                          >
                            {p.code}
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  {!activeRole.isSystem && (
                    <div className="border-t border-border pt-3">
                      <Button asChild className="w-full bg-accent text-accent-foreground" size="sm">
                        <Link href={`/admin/roles/${activeRole.id}`}>Edit Permissions Matrix</Link>
                      </Button>
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
