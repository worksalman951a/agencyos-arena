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
import type { UserResponse } from '@/lib/services/admin/user-service';
import '@/components/crm/bento-contacts.css';

interface BentoUsersViewProps {
  users: UserResponse[];
}

export function BentoUsersView({ users }: BentoUsersViewProps) {
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const activeUser = users[Math.min(selectedIdx, Math.max(0, users.length - 1))] ?? null;

  const totalUsers = users.length;
  const activeCount = users.filter((u) => u.status === 'active').length;
  const suspendedCount = users.filter((u) => u.status === 'suspended').length;
  const adminOwnerCount = users.filter((u) => u.role === 'admin' || u.role === 'owner').length;

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Administration</span>
            <span>/</span>
            <span>Identity & Access Management</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">
            Users & Members
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage organization members, system roles, and account security states
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/invitations">Manage Invitations</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/roles">Roles & Permissions</Link>
          </Button>
        </div>
      </div>

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Total Members',
            value: String(totalUsers),
            note: 'registered users in workspace',
          },
          {
            label: 'Active Accounts',
            value: String(activeCount),
            note: 'authorized to sign in',
            tone: 'ok',
          },
          {
            label: 'Admins & Owners',
            value: String(adminOwnerCount),
            note: 'privileged administrators',
          },
          {
            label: 'Suspended',
            value: String(suspendedCount),
            note: 'access restricted',
            tone: suspendedCount > 0 ? 'danger' : undefined,
          },
        ]}
      />

      {/* ── Users Grid & Inspector ───────────────────────────────────── */}
      {users.length === 0 ? (
        <Panel pad>
          <EmptyState
            title="No organization members found"
            sub="Invite teammates using the invitations manager to populate your workspace."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2 min-w-0">
            <Panel title={`Members Directory (${users.length})`}>
              <div className="bento-sales-table-head">
                <span>User & Email</span>
                <span>Primary Role</span>
                <span>Custom Roles</span>
                <span className="text-right">Status</span>
                <span className="text-right">Action</span>
              </div>

              <div className="divide-y divide-border/60">
                {users.map((u, idx) => {
                  const isSelected = activeUser?.id === u.id;

                  return (
                    <div
                      key={u.id}
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
                          {u.name || 'Unnamed'}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          {u.email}
                        </div>
                      </div>

                      <div className="min-w-0 pr-2 text-xs font-medium text-foreground truncate">
                        {u.role}
                      </div>

                      <div className="min-w-0 pr-2 text-xs text-muted-foreground truncate">
                        {u.roles.length > 0 ? u.roles.join(', ') : '—'}
                      </div>

                      <div className="text-right">
                        <StatusPill
                          tone={
                            u.status === 'active'
                              ? 'ok'
                              : u.status === 'suspended'
                                ? 'danger'
                                : undefined
                          }
                        >
                          {u.status}
                        </StatusPill>
                      </div>

                      <div className="text-right" onClick={(e) => e.stopPropagation()}>
                        <Link
                          href={`/admin/users/${u.id}`}
                          className="text-xs font-semibold text-accent hover:underline inline-flex items-center gap-1"
                        >
                          Edit
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>

          <div className="min-w-0">
            {activeUser ? (
              <Panel
                title="Member Inspector"
                action={
                  <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                    <Link href={`/admin/users/${activeUser.id}`}>
                      Edit User <Eye size={12} className="ml-1" />
                    </Link>
                  </Button>
                }
              >
                <div className="space-y-4 text-xs">
                  <div>
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                      Member Profile
                    </span>
                    <h3 className="text-sm font-bold text-foreground mt-0.5">
                      {activeUser.name || 'Unnamed Member'}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                      {activeUser.email}
                    </p>
                  </div>

                  <div className="border-t border-border pt-3 space-y-2.5">
                    <KeyValueRow
                      label="Account Status"
                      value={
                        <StatusPill
                          tone={
                            activeUser.status === 'active'
                              ? 'ok'
                              : activeUser.status === 'suspended'
                                ? 'danger'
                                : undefined
                          }
                        >
                          {activeUser.status}
                        </StatusPill>
                      }
                    />
                    <KeyValueRow label="Primary System Role" value={activeUser.role} />
                    <KeyValueRow
                      label="Assigned Roles"
                      value={
                        activeUser.roles.length > 0
                          ? activeUser.roles.join(', ')
                          : 'Standard default'
                      }
                    />
                    <KeyValueRow
                      label="Member Since"
                      value={new Date(activeUser.createdAt).toLocaleDateString()}
                    />
                  </div>

                  <div className="border-t border-border pt-3">
                    <Button asChild className="w-full bg-accent text-accent-foreground" size="sm">
                      <Link href={`/admin/users/${activeUser.id}`}>Configure Role & Status</Link>
                    </Button>
                  </div>
                </div>
              </Panel>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
