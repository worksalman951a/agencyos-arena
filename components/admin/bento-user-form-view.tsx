'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Shield, User, Mail, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { Panel, StatStrip, StatusPill, KeyValueRow } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import '@/components/crm/bento-contacts.css';

interface RoleOption {
  id: string;
  name: string;
  isSystem: boolean;
}

interface MemberDetail {
  id: string;
  email: string;
  name: string | null;
  role: string;
  roles: string[];
  status: string;
}

interface BentoUserFormViewProps {
  member: MemberDetail | null;
  roles: RoleOption[];
  roleId: string;
  setRoleId: (roleId: string) => void;
  status: string;
  setStatus: (status: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  loadError: string | null;
}

export function BentoUserFormView({
  member,
  roles,
  roleId,
  setRoleId,
  status,
  setStatus,
  onSubmit,
  isLoading,
  loadError,
}: BentoUserFormViewProps) {
  const selectedRole = roles.find((r) => r.id === roleId);

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-8 w-8" title="Cancel and return">
            <Link href="/admin/users">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Link href="/admin/users" className="hover:underline">
                Administration
              </Link>
              <span>/</span>
              <Link href="/admin/users" className="hover:underline">
                Users & Members
              </Link>
              <span>/</span>
              <span>Edit Member</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              Edit Member: {member?.name || member?.email || 'Loading…'}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="h-8 text-xs">
            <Link href="/admin/users">Cancel</Link>
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isLoading || !member}
            onClick={onSubmit}
            className="h-8 text-xs bg-accent text-accent-foreground hover:bg-accent/90"
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {isLoading ? 'Saving Changes…' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {loadError && (
        <div
          role="alert"
          className="p-3 text-xs bg-destructive/10 text-destructive rounded-md border border-destructive/20 flex items-center gap-2"
        >
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {/* ── Context & Governance Metrics ──────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Member Identity',
            value: member?.name || 'Unnamed',
            note: member?.email ?? 'organization user',
          },
          {
            label: 'Assigned Role',
            value: selectedRole?.name || member?.role || 'None',
            note: selectedRole?.isSystem ? 'System Baseline' : 'Custom Policy',
          },
          {
            label: 'Account Status',
            value: status.toUpperCase(),
            note: status === 'active' ? 'Authorized to sign in' : 'Access restricted',
            tone: status === 'active' ? 'ok' : 'danger',
          },
          {
            label: 'Security Clearance',
            value: roles.length > 0 ? `${roles.length} roles available` : 'RBAC Protected',
            note: 'Enforces Last-Admin guard',
          },
        ]}
      />

      {/* ── Form Body & Inspection Sidebar ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Main Configuration Panels */}
        <div className="lg:col-span-2 space-y-6">
          <Panel title="Role Assignment & Authority">
            <form onSubmit={onSubmit} className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label
                  htmlFor="roleId"
                  className="font-semibold text-foreground flex items-center gap-1.5"
                >
                  <Shield className="h-3.5 w-3.5 text-accent" />
                  Assign Organization Role
                </label>
                <select
                  id="roleId"
                  value={roleId}
                  onChange={(e) => setRoleId(e.target.value)}
                  disabled={isLoading || !member}
                  className="w-full border border-input rounded-md px-3 py-2 text-xs bg-background text-foreground"
                >
                  <option value="">Keep current role</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                      {role.isSystem ? ' (System)' : ' (Custom)'}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Assigning a role replaces the member&apos;s current role assignment in this
                  organization. Last active administrator cannot be demoted or unassigned.
                </p>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-border">
                <label
                  htmlFor="status"
                  className="font-semibold text-foreground flex items-center gap-1.5"
                >
                  <User className="h-3.5 w-3.5 text-accent" />
                  Account Lifecycle Status
                </label>
                <select
                  id="status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  disabled={isLoading || !member}
                  className="w-full border border-input rounded-md px-3 py-2 text-xs bg-background text-foreground"
                >
                  <option value="active">Active (Authorized sign-in)</option>
                  <option value="suspended">Suspended (Access immediately revoked)</option>
                  <option value="invited">Invited (Awaiting verification)</option>
                </select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Suspended accounts retain their audit history and database associations, but
                  cannot sign in.
                </p>
              </div>

              <div className="pt-3 border-t border-border flex justify-end gap-2">
                <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                  <Link href="/admin/users">Cancel</Link>
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isLoading || !member}
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
          <Panel title="Member Governance Profile">
            <div className="p-1 space-y-3 text-xs">
              <div className="space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block">
                  Identity Details
                </span>
                <div className="font-semibold text-foreground">{member?.name || 'Unnamed'}</div>
                <div className="text-muted-foreground font-mono flex items-center gap-1.5">
                  <Mail className="h-3 w-3" />
                  {member?.email || '—'}
                </div>
              </div>

              <div className="border-t border-border pt-2 space-y-2">
                <KeyValueRow
                  label="Status"
                  value={
                    <StatusPill tone={status === 'active' ? 'ok' : 'danger'}>{status}</StatusPill>
                  }
                />
                <KeyValueRow label="Current Role" value={member?.role || 'Default'} />
                <KeyValueRow
                  label="Assigned Roles"
                  value={
                    member?.roles && member.roles.length > 0 ? member.roles.join(', ') : 'None'
                  }
                />
              </div>

              <div className="border-t border-border pt-3 space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Security Guardrails
                </div>
                <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-accent shrink-0 mt-0.5" />
                  <span>Self-demotion prevention prevents lockouts.</span>
                </div>
                <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-accent shrink-0 mt-0.5" />
                  <span>Changes generate forensic entries in the organization audit trail.</span>
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
