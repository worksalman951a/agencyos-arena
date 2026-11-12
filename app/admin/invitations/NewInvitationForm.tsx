'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Mail, Shield, UserPlus, CheckCircle2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useBentoShell } from '@/components/providers/bento-theme-provider';

/**
 * Invitation form.
 *
 * The API returns the raw token once. It is shown here (and nowhere else) so an
 * administrator can hand the link over; only the hash is persisted.
 */
export function NewInvitationForm({ roles }: { roles: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const isBento = useBentoShell();
  const [pending, setPending] = React.useState(false);
  const [inviteLink, setInviteLink] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setPending(true);
    setInviteLink(null);
    setCopied(false);

    try {
      const res = await fetch('/api/v1/admin/invitations', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          email: String(formData.get('email') ?? ''),
          roleId: String(formData.get('roleId') ?? ''),
        }),
      });

      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        acceptPath?: string;
      };

      if (!res.ok) {
        toast.error(body.error ?? 'Could not create the invitation');
        return;
      }

      const path = body.acceptPath ?? '';
      setInviteLink(`${window.location.origin}${path}`);
      toast.success('Invitation created — copy the link below');
      form.reset();
      router.refresh();
    } catch {
      toast.error('Network error, please try again.');
    } finally {
      setPending(false);
    }
  }

  const handleCopy = () => {
    if (inviteLink) {
      navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      toast.success('Invitation link copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (isBento) {
    return (
      <div className="space-y-4 text-xs">
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div className="space-y-1.5 md:col-span-1">
            <label
              className="font-semibold text-foreground flex items-center gap-1.5"
              htmlFor="bento-invite-email"
            >
              <Mail className="h-3.5 w-3.5 text-accent" />
              Teammate E-mail <span className="text-destructive">*</span>
            </label>
            <Input
              id="bento-invite-email"
              name="email"
              type="email"
              required
              placeholder="teammate@agency.test"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <label
              className="font-semibold text-foreground flex items-center gap-1.5"
              htmlFor="bento-invite-role"
            >
              <Shield className="h-3.5 w-3.5 text-accent" />
              Assigned Role <span className="text-destructive">*</span>
            </label>
            <select
              id="bento-invite-role"
              name="roleId"
              required
              defaultValue={roles[0]?.id ?? ''}
              className="w-full border border-input rounded-md px-2.5 py-1.5 text-xs bg-background text-foreground"
            >
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="submit"
            disabled={pending || roles.length === 0}
            className="h-8 text-xs bg-accent text-accent-foreground hover:bg-accent/90"
          >
            <UserPlus className="h-3.5 w-3.5 mr-1.5" />
            {pending ? 'Generating Invite…' : 'Generate Invitation'}
          </Button>
        </form>

        {inviteLink && (
          <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground flex items-center gap-1.5 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                Single-Use Invitation Link (Shown Once)
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopy}
                className="h-6 px-2 text-[11px] gap-1"
              >
                <Copy className="h-3 w-3" />
                {copied ? 'Copied!' : 'Copy Link'}
              </Button>
            </div>
            <code
              data-testid="invitation-link"
              className="block break-all text-[11px] font-mono bg-background p-2 rounded border border-border text-foreground"
            >
              {inviteLink}
            </code>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <div className="space-y-1 md:col-span-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="email">
            E-mail
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            placeholder="teammate@agency.test"
            className="w-full border border-input rounded-md px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="roleId">
            Role
          </label>
          <select
            id="roleId"
            name="roleId"
            required
            defaultValue={roles[0]?.id ?? ''}
            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={pending || roles.length === 0}
          className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium disabled:opacity-50 hover:bg-accent/90"
        >
          {pending ? 'Inviting…' : 'Create invitation'}
        </button>
      </form>

      {inviteLink ? (
        <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
          <p className="font-medium">Acceptance link (shown once)</p>
          <code data-testid="invitation-link" className="block break-all text-xs">
            {inviteLink}
          </code>
        </div>
      ) : null}
    </div>
  );
}
