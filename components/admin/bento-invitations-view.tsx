'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Panel,
  EmptyState,
  KeyValueRow,
  StatusPill,
  StatStrip,
} from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import type { InvitationResponse } from '@/lib/services/admin/invitation-service';
import '@/components/crm/bento-contacts.css';

interface BentoInvitationsViewProps {
  invitations: InvitationResponse[];
  formNode: React.ReactNode;
}

export function BentoInvitationsView({ invitations, formNode }: BentoInvitationsViewProps) {
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const activeInvitation =
    invitations[Math.min(selectedIdx, Math.max(0, invitations.length - 1))] ?? null;

  const totalInvitations = invitations.length;
  const pendingCount = invitations.filter((i) => i.status === 'pending').length;
  const acceptedCount = invitations.filter((i) => i.status === 'accepted').length;

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Administration</span>
            <span>/</span>
            <span>Member Onboarding</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">
            Team Invitations
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Invite teammates into this organization. Invitations expire after 7 days and are
            single-use.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/users">Users Directory</Link>
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
            label: 'Total Invitations',
            value: String(totalInvitations),
            note: 'issued invitation records',
          },
          {
            label: 'Pending Acceptance',
            value: String(pendingCount),
            note: 'awaiting teammate activation',
            tone: pendingCount > 0 ? 'warn' : undefined,
          },
          {
            label: 'Accepted & Onboarded',
            value: String(acceptedCount),
            note: 'active organization members',
            tone: 'ok',
          },
        ]}
      />

      {/* ── Invitation Form Panel ────────────────────────────────────── */}
      <Panel title="Invite a Teammate">
        <p className="text-xs text-muted-foreground mb-4">
          The acceptance token is displayed exactly once upon creation for security. Token hashes
          are stored server-side.
        </p>
        <div className="max-w-2xl">{formNode}</div>
      </Panel>

      {/* ── Invitations Grid & Inspector ────────────────────────────── */}
      {invitations.length === 0 ? (
        <Panel pad>
          <EmptyState
            title="No invitations issued yet"
            sub="Send your first team invitation above to onboard new members."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2 min-w-0">
            <Panel title={`Invitations Register (${invitations.length})`}>
              <div className="bento-sales-table-head">
                <span>E-mail</span>
                <span>Assigned Role</span>
                <span className="text-right">Expires</span>
                <span className="text-right">Status</span>
              </div>

              <div className="divide-y divide-border/60">
                {invitations.map((inv, idx) => {
                  const isSelected = activeInvitation?.id === inv.id;

                  return (
                    <div
                      key={inv.id}
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
                          {inv.email}
                        </div>
                      </div>

                      <div className="min-w-0 pr-2 text-xs text-muted-foreground truncate">
                        {inv.roleName}
                      </div>

                      <div className="text-xs text-muted-foreground text-right font-mono">
                        {new Date(inv.expiresAt).toLocaleDateString()}
                      </div>

                      <div className="text-right">
                        <StatusPill
                          tone={
                            inv.status === 'accepted'
                              ? 'ok'
                              : inv.status === 'pending'
                                ? 'warn'
                                : undefined
                          }
                        >
                          {inv.status}
                        </StatusPill>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>

          <div className="min-w-0">
            {activeInvitation ? (
              <Panel title="Invitation Details">
                <div className="space-y-4 text-xs">
                  <div>
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                      Invited Recipient
                    </span>
                    <h3 className="text-sm font-bold text-foreground mt-0.5 truncate">
                      {activeInvitation.email}
                    </h3>
                  </div>

                  <div className="border-t border-border pt-3 space-y-2.5">
                    <KeyValueRow
                      label="Invitation Status"
                      value={
                        <StatusPill
                          tone={
                            activeInvitation.status === 'accepted'
                              ? 'ok'
                              : activeInvitation.status === 'pending'
                                ? 'warn'
                                : undefined
                          }
                        >
                          {activeInvitation.status}
                        </StatusPill>
                      }
                    />
                    <KeyValueRow label="Assigned Role" value={activeInvitation.roleName} />
                    <KeyValueRow
                      label="Expiration Date"
                      value={new Date(activeInvitation.expiresAt).toLocaleDateString()}
                    />
                    <KeyValueRow
                      label="Created Date"
                      value={new Date(activeInvitation.createdAt).toLocaleDateString()}
                    />
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
