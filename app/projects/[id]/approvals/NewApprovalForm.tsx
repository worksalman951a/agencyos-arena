'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/toast';

/** Record a client approval for a project (Client Component). */
export function NewApprovalForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const contactId = String(formData.get('contactId') ?? '').trim();

    setPending(true);
    try {
      const res = await fetch('/api/v1/projects/approvals', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          projectId,
          ...(contactId ? { contactId } : {}),
          status: String(formData.get('status') ?? 'pending'),
          feedback: String(formData.get('feedback') ?? '') || undefined,
        }),
      });

      if (res.status === 401) {
        router.push('/login');
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast({
          title: 'Could not record approval',
          description: body.error ?? 'Please check the form and try again.',
          variant: 'destructive',
        });
        return;
      }

      toast({ title: 'Approval recorded' });
      formRef.current?.reset();
      router.refresh();
    } catch {
      toast({
        title: 'Could not record approval',
        description: 'Network error.',
        variant: 'destructive',
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="approval-contact">
            Contact ID
          </label>
          <input
            id="approval-contact"
            type="text"
            name="contactId"
            placeholder="Client contact CUID (optional)"
            className="w-full border border-input rounded-md px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="approval-status">
            Status
          </label>
          <select
            id="approval-status"
            name="status"
            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="changes_requested">Changes Requested</option>
          </select>
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="approval-feedback">
          Feedback
        </label>
        <textarea
          id="approval-feedback"
          name="feedback"
          rows={2}
          placeholder="Client feedback or notes..."
          className="w-full border border-input rounded-md px-3 py-2 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
      >
        {pending ? 'Recording…' : 'Record Approval'}
      </button>
    </form>
  );
}
