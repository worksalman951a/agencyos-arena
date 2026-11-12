'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Shield, Key, AlertTriangle, CheckCircle2, Lock } from 'lucide-react';
import { Panel, StatStrip, StatusPill, KeyValueRow } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import '@/components/crm/bento-contacts.css';

interface PermissionOption {
  id: string;
  code: string;
  description: string | null;
}

interface BentoRoleFormViewProps {
  roleId: string;
  name: string;
  setName: (name: string) => void;
  description: string;
  setDescription: (desc: string) => void;
  permissionCodes: string[];
  setPermissionCodes: React.Dispatch<React.SetStateAction<string[]>>;
  availablePermissions: PermissionOption[];
  isSystem: boolean;
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  error: string | null;
}

export function BentoRoleFormView({
  name,
  setName,
  description,
  setDescription,
  permissionCodes,
  setPermissionCodes,
  availablePermissions,
  isSystem,
  onSubmit,
  isLoading,
  error,
}: Omit<BentoRoleFormViewProps, 'roleId'>) {
  const [filterQuery, setFilterQuery] = React.useState('');

  const filteredPermissions = React.useMemo(() => {
    if (!filterQuery.trim()) return availablePermissions;
    const q = filterQuery.toLowerCase();
    return availablePermissions.filter(
      (p) =>
        p.code.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q))
    );
  }, [availablePermissions, filterQuery]);

  // Group permissions by category (prefix before dot, e.g. "user", "project", "role")
  const groupedCategories = React.useMemo(() => {
    const map = new Map<string, PermissionOption[]>();
    for (const p of filteredPermissions) {
      const category = p.code.includes('.') ? p.code.split('.')[0] : 'general';
      const list = map.get(category) ?? [];
      list.push(p);
      map.set(category, list);
    }
    return Array.from(map.entries());
  }, [filteredPermissions]);

  const togglePermission = (code: string) => {
    if (isSystem) return;
    setPermissionCodes((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-8 w-8" title="Cancel and return">
            <Link href="/admin/roles">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Link href="/admin/roles" className="hover:underline">
                Administration
              </Link>
              <span>/</span>
              <Link href="/admin/roles" className="hover:underline">
                Roles & Permissions
              </Link>
              <span>/</span>
              <span>Edit Role</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              Edit Role: {name || 'Custom Role'}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="h-8 text-xs">
            <Link href="/admin/roles">Cancel</Link>
          </Button>
          {!isSystem && (
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
          )}
        </div>
      </div>

      {isSystem && (
        <div className="p-3 text-xs bg-muted text-muted-foreground rounded-md border border-border flex items-center gap-2">
          <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>
            This is a system baseline role. System roles are immutable and cannot be edited or
            deleted.
          </span>
        </div>
      )}

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
            label: 'Role Classification',
            value: isSystem ? 'System Role' : 'Custom Organization Role',
            note: isSystem ? 'Immutable baseline' : 'Tenant configurable',
            tone: isSystem ? undefined : 'ok',
          },
          {
            label: 'Assigned Capabilities',
            value: `${permissionCodes.length} of ${availablePermissions.length}`,
            note: 'active permission grants',
          },
          {
            label: 'Privilege Boundary',
            value: 'Actor-scoped',
            note: 'Cannot grant codes above actor privilege',
          },
          {
            label: 'Audit Logging',
            value: 'Active',
            note: 'All modifications recorded in forensic trail',
            tone: 'ok',
          },
        ]}
      />

      {/* ── Main Form & Permission Matrix ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-6">
          <Panel title="Role Metadata">
            <form onSubmit={onSubmit} className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label
                  htmlFor="role-name"
                  className="font-semibold text-foreground flex items-center gap-1.5"
                >
                  <Shield className="h-3.5 w-3.5 text-accent" />
                  Role Name <span className="text-destructive">*</span>
                </label>
                <Input
                  id="role-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isLoading || isSystem}
                  placeholder="e.g. Finance Auditor"
                  className="h-8 text-xs"
                  required
                />
                <p className="text-[11px] text-muted-foreground">
                  Unique name identifying this role within your organization workspace.
                </p>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-border">
                <label htmlFor="role-desc" className="font-semibold text-foreground">
                  Description
                </label>
                <textarea
                  id="role-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={isLoading || isSystem}
                  rows={2}
                  placeholder="Describe the responsibilities and authority of this role..."
                  className="w-full border border-input rounded-md px-3 py-2 text-xs bg-background text-foreground"
                />
              </div>

              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <label className="font-semibold text-foreground flex items-center gap-1.5">
                    <Key className="h-3.5 w-3.5 text-accent" />
                    Granted Permission Capabilities ({permissionCodes.length})
                  </label>
                  <Input
                    placeholder="Filter permissions..."
                    value={filterQuery}
                    onChange={(e) => setFilterQuery(e.target.value)}
                    className="h-7 text-xs sm:w-48"
                  />
                </div>

                <div className="border border-input rounded-md divide-y divide-border/60 max-h-96 overflow-y-auto bg-muted/10 p-2 space-y-3">
                  {groupedCategories.map(([category, perms]) => (
                    <div key={category} className="pt-2 first:pt-0">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 px-1">
                        {category} Scope (
                        {perms.filter((p) => permissionCodes.includes(p.code)).length}/
                        {perms.length})
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {perms.map((p) => {
                          const isChecked = permissionCodes.includes(p.code);
                          return (
                            <label
                              key={p.id}
                              className={`flex items-start gap-2 p-1.5 rounded text-xs cursor-pointer transition-colors ${
                                isChecked
                                  ? 'bg-accent/15 border border-accent/30'
                                  : 'hover:bg-muted/40 border border-transparent'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                disabled={isLoading || isSystem}
                                onChange={() => togglePermission(p.code)}
                                className="mt-0.5 rounded border-input text-accent bg-background"
                              />
                              <div className="min-w-0">
                                <div className="font-mono font-medium text-foreground text-[11px] truncate">
                                  {p.code}
                                </div>
                                {p.description && (
                                  <div className="text-[10px] text-muted-foreground line-clamp-1">
                                    {p.description}
                                  </div>
                                )}
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {!isSystem && (
                <div className="pt-3 border-t border-border flex justify-end gap-2">
                  <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                    <Link href="/admin/roles">Cancel</Link>
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
              )}
            </form>
          </Panel>
        </div>

        {/* Sidebar Info & Safety Audit */}
        <div className="space-y-6">
          <Panel title="Governance Summary">
            <div className="p-1 space-y-3 text-xs">
              <div className="space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block">
                  Role Classification
                </span>
                <div className="font-semibold text-foreground flex items-center gap-2">
                  <span>{name || 'Role'}</span>
                  <StatusPill tone={isSystem ? undefined : 'ok'}>
                    {isSystem ? 'System Baseline' : 'Custom'}
                  </StatusPill>
                </div>
              </div>

              <div className="border-t border-border pt-2 space-y-2">
                <KeyValueRow
                  label="Classification"
                  value={isSystem ? 'System Baseline' : 'Custom Organization Scope'}
                />
                <KeyValueRow
                  label="Permissions Total"
                  value={`${permissionCodes.length} active codes`}
                />
              </div>

              <div className="border-t border-border pt-3 space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Security Guardrails
                </div>
                <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-accent shrink-0 mt-0.5" />
                  <span>Privilege escalation protection prevents granting unheld permissions.</span>
                </div>
                <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-accent shrink-0 mt-0.5" />
                  <span>Cannot rename a custom role to match system roles.</span>
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
