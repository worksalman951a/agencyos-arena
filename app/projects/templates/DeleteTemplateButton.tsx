'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export function DeleteTemplateButton({
  templateId,
  redirectAfter = false,
}: {
  templateId: string;
  redirectAfter?: boolean;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (
      !window.confirm('Delete this project template? Existing projects using it will stay intact.')
    ) {
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/projects/templates/${encodeURIComponent(templateId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Failed to delete template');
      }
      toast.success('Template deleted');
      if (redirectAfter) {
        router.push('/projects/templates');
      }
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={deleting}
      className="text-sm text-destructive hover:underline disabled:opacity-50"
    >
      {deleting ? 'Deleting…' : 'Delete'}
    </button>
  );
}
