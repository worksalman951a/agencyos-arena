'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

interface ProjectTaskOption {
  id: string;
  title: string;
}

export function ProjectFileForm({
  projectId,
  tasks = [],
}: {
  projectId: string;
  tasks?: ProjectTaskOption[];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [taskId, setTaskId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedFile) {
      toast.error('Please select a file to upload.');
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('projectId', projectId);
      if (taskId) {
        formData.append('taskId', taskId);
      }
      formData.append('file', selectedFile);

      const res = await fetch('/api/v1/projects/files/upload', {
        method: 'POST',
        body: formData,
      });

      if (res.status === 401) {
        router.push('/login');
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? 'Failed to upload file');
        return;
      }

      toast.success('File uploaded');
      setSelectedFile(null);
      setTaskId('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      router.refresh();
    } catch {
      toast.error('Failed to upload file');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label htmlFor="project-file-input" className="text-sm font-medium">
            Select File
          </label>
          <input
            ref={fileInputRef}
            id="project-file-input"
            name="file"
            type="file"
            required
            disabled={submitting}
            onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
          />
          <p className="text-xs text-muted-foreground">
            Max 10 MB. Stored outside web root and served via authenticated download.
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="project-file-task" className="text-sm font-medium">
            Task (optional)
          </label>
          <select
            id="project-file-task"
            name="taskId"
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            disabled={submitting}
            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
          >
            <option value="">Project-level file</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting || !selectedFile}
        className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
      >
        {submitting ? 'Uploading…' : 'Upload File'}
      </button>
    </form>
  );
}
