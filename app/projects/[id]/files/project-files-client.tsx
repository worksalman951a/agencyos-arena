'use client';

import * as React from 'react';
import Link from 'next/link';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoProjectFilesView } from '@/components/projects/bento-project-files-view';
import { ProjectFileForm } from './ProjectFileForm';
import { DeleteProjectFileButton } from './DeleteProjectFileButton';
import type { ProjectFileResponse } from '@/lib/services/projects/project-file-service';

interface ProjectFilesClientProps {
  projectId: string;
  projectName?: string;
  files: ProjectFileResponse[];
  tasks: Array<{ id: string; title: string }>;
}

export function ProjectFilesClient({
  projectId,
  projectName,
  files,
  tasks,
}: ProjectFilesClientProps) {
  const isBento = useBentoShell();

  if (isBento) {
    return (
      <BentoProjectFilesView
        projectId={projectId}
        projectName={projectName}
        files={files}
        uploadFormNode={<ProjectFileForm projectId={projectId} tasks={tasks} />}
      />
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Project Files</h1>
          <p className="text-sm text-muted-foreground">
            Manage files and attachments{projectName ? ` for ${projectName}` : ''}.
          </p>
        </div>
        <Link
          href={`/projects/${projectId}`}
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Back to Project
        </Link>
      </div>

      <div className="rounded-md border bg-background p-6 max-w-3xl">
        <h2 className="text-lg font-semibold mb-4">Upload File</h2>
        <ProjectFileForm projectId={projectId} tasks={tasks} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">File Name</th>
              <th className="pb-3 font-medium w-48">Type</th>
              <th className="pb-3 font-medium text-right">Size</th>
              <th className="pb-3 font-medium w-32">Task</th>
              <th className="pb-3 font-medium">Uploaded By</th>
              <th className="pb-3 font-medium text-right">Uploaded</th>
              <th className="pb-3 font-medium w-40 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {files.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-muted-foreground">
                  No files found. Upload a file to get started.
                </td>
              </tr>
            ) : (
              files.map((file) => (
                <tr key={file.id} className="border-b border-border hover:bg-muted/50">
                  <td className="py-4 font-medium">
                    {file.fileAsset?.originalName ?? 'Unnamed file'}
                  </td>
                  <td className="py-4 text-sm text-muted-foreground">
                    {file.fileAsset?.mimeType ?? '—'}
                  </td>
                  <td className="py-4 text-right text-sm">
                    {file.fileAsset ? `${(file.fileAsset.size / 1024).toFixed(1)} KB` : '—'}
                  </td>
                  <td className="py-4 text-sm text-muted-foreground">{file.task?.title ?? '—'}</td>
                  <td className="py-4 text-sm text-muted-foreground">
                    {file.user?.name ?? file.user?.email ?? '—'}
                  </td>
                  <td className="py-4 text-right text-sm text-muted-foreground">
                    {new Date(file.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-4 text-right whitespace-nowrap space-x-3">
                    <a
                      href={`/api/v1/projects/files/${encodeURIComponent(file.id)}/download`}
                      className="text-xs text-accent hover:underline"
                    >
                      Download
                    </a>
                    <DeleteProjectFileButton fileId={file.id} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
