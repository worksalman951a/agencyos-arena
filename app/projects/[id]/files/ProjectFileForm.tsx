'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/toast';

/**
 * Attach an already-uploaded file asset to a project (Client Component).
 *
 * Replaces an in-Server-Component `onClick` handler, which Next.js cannot
 * serialise, so the form previously did nothing (or crashed on render).
 */
export function ProjectFileForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const fileAssetId = String(formData.get('fileAssetId') ?? '').trim();
    const taskId = String(formData.get('taskId') ?? '').trim();

    if (!fileAssetId) {
      toast({ title: 'File asset ID is required', variant: 'destructive' });
      return;
    }

    setPending(true);
    try {
      const res = await fetch('/api/v1/projects/files', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          projectId,
          fileAssetId,
          ...(taskId ? { taskId } : {}),
        }),
      });

      if (res.status === 401) {
        router.push('/login');
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast({
          title: 'Could not attach file',
          description: body.error ?? 'Please check the file asset ID.',
          variant: 'destructive',
        });
        return;
      }

      toast({ title: 'File attached' });
      formRef.current?.reset();
      router.refresh();
    } catch {
      toast({
        title: 'Could not attach file',
        description: 'Network error.',
        variant: 'destructive',
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="file-asset-id">
          File Asset ID
        </label>
        <input
          id="file-asset-id"
          type="text"
          name="fileAssetId"
          placeholder="File asset CUID (from upload)"
          className="w-full border border-input rounded-md px-3 py-2 text-sm"
          required
        />
        <p className="text-xs text-muted-foreground">
          Enter the File Asset ID from a completed upload. Files are stored outside the web root and
          served via signed URLs.
        </p>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="file-task-id">
          Task ID (optional)
        </label>
        <input
          id="file-task-id"
          type="text"
          name="taskId"
          placeholder="Associate with a specific task"
          className="w-full border border-input rounded-md px-3 py-2 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
      >
        {pending ? 'Attaching…' : 'Attach File'}
      </button>
    </form>
  );
}
