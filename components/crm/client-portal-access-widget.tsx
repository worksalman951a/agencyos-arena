'use client';

import * as React from 'react';
import { Mail, UserX, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';
import { Panel, StatusPill } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';

interface PortalAccessState {
  id: string;
  email: string;
  status: 'pending' | 'active' | 'revoked';
  invitedAt: string;
  activatedAt?: string | null;
  revokedAt?: string | null;
  lastLoginAt?: string | null;
}

interface ClientPortalAccessWidgetProps {
  contactId: string;
  contactEmail: string | null;
}

export function ClientPortalAccessWidget({
  contactId,
  contactEmail,
}: ClientPortalAccessWidgetProps) {
  const [access, setAccess] = React.useState<PortalAccessState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [confirmRevoke, setConfirmRevoke] = React.useState(false);
  const [message, setMessage] = React.useState<{ text: string; error?: boolean } | null>(null);

  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let active = true;

    async function load() {
      try {
        const res = await fetch(`/api/v1/crm/contacts/${contactId}/portal-access`);
        if (res.ok && active) {
          const data = await res.json();
          setAccess(data.portalAccess || null);
        }
      } catch {
        // Non-fatal
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [contactId, reloadKey]);

  const handleInvite = async () => {
    if (!contactEmail) {
      setMessage({ text: 'Contact must have a valid email address to invite.', error: true });
      return;
    }

    setIsSubmitting(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/v1/crm/contacts/${contactId}/portal-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: contactEmail }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to send portal invitation');
      }

      setMessage({ text: 'Portal access invitation successfully issued.' });
      setReloadKey((k) => k + 1);
    } catch (err) {
      setMessage({ text: (err as Error).message, error: true });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevoke = async () => {
    setIsSubmitting(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/v1/crm/contacts/${contactId}/portal-access`, {
        method: 'DELETE',
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to revoke portal access');
      }

      setMessage({ text: 'Portal access and active sessions revoked.' });
      setConfirmRevoke(false);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setMessage({ text: (err as Error).message, error: true });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Panel title="Client Portal Access">
      <div className="space-y-3 text-xs p-1">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-2">
            <Loader2 size={13} className="animate-spin" />
            <span>Loading portal authorization status…</span>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between pb-1">
              <span className="text-muted-foreground">Authorization State</span>
              <StatusPill
                tone={
                  access?.status === 'active'
                    ? 'ok'
                    : access?.status === 'pending'
                      ? 'warn'
                      : access?.status === 'revoked'
                        ? 'danger'
                        : undefined
                }
              >
                {access ? access.status.toUpperCase() : 'NOT PROVISIONED'}
              </StatusPill>
            </div>

            {message && (
              <div
                className={`p-2 rounded text-[11px] flex items-start gap-1.5 ${
                  message.error
                    ? 'bg-destructive/10 text-destructive border border-destructive/20'
                    : 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 border border-emerald-500/20'
                }`}
              >
                {message.error ? (
                  <AlertCircle size={13} className="shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 size={13} className="shrink-0 mt-0.5" />
                )}
                <span>{message.text}</span>
              </div>
            )}

            {access && (
              <div className="space-y-1.5 bg-muted/20 p-2.5 rounded border border-border text-[11px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Authorized Email</span>
                  <span className="font-mono font-medium text-foreground">{access.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Invited At</span>
                  <span className="text-foreground">
                    {new Date(access.invitedAt).toLocaleDateString()}
                  </span>
                </div>
                {access.activatedAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Activated At</span>
                    <span className="text-foreground">
                      {new Date(access.activatedAt).toLocaleDateString()}
                    </span>
                  </div>
                )}
                {access.lastLoginAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Last Session</span>
                    <span className="text-foreground">
                      {new Date(access.lastLoginAt).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="pt-2 border-t border-border flex items-center justify-between gap-2">
              {!access || access.status === 'revoked' ? (
                <Button
                  size="sm"
                  onClick={handleInvite}
                  disabled={isSubmitting || !contactEmail}
                  className="w-full h-8 text-xs bg-accent text-accent-foreground hover:bg-accent/90"
                >
                  <Mail size={12} className="mr-1.5" />
                  {isSubmitting ? 'Issuing…' : 'Invite to Client Portal'}
                </Button>
              ) : confirmRevoke ? (
                <div className="w-full space-y-2">
                  <p className="text-[11px] text-destructive font-medium">
                    Confirm revoking portal access? All active client sessions will terminate
                    immediately.
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={handleRevoke}
                      disabled={isSubmitting}
                      className="h-7 text-xs flex-1"
                    >
                      <UserX size={12} className="mr-1" />
                      {isSubmitting ? 'Revoking…' : 'Confirm Revoke'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setConfirmRevoke(false)}
                      disabled={isSubmitting}
                      className="h-7 text-xs"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="w-full flex items-center justify-between gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleInvite}
                    disabled={isSubmitting || !contactEmail}
                    className="h-7 text-xs"
                  >
                    <Mail size={12} className="mr-1" />
                    Re-send Invite
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmRevoke(true)}
                    disabled={isSubmitting}
                    className="h-7 text-xs text-destructive hover:bg-destructive/10"
                  >
                    <UserX size={12} className="mr-1" />
                    Revoke Access
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
