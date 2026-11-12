'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Download } from 'lucide-react';
import { Panel, EmptyState, KeyValueRow, StatStrip } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import type { ProjectFileResponse } from '@/lib/services/projects/project-file-service';
import '@/components/crm/bento-contacts.css';

interface BentoProjectFilesViewProps {
  projectId: string;
  projectName?: string;
  files: ProjectFileResponse[];
  uploadFormNode: React.ReactNode;
}

export function BentoProjectFilesView({
  projectId,
  projectName,
  files,
  uploadFormNode,
}: BentoProjectFilesViewProps) {
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const activeFile = files[Math.min(selectedIdx, Math.max(0, files.length - 1))] ?? null;

  const totalBytes = files.reduce((sum, f) => sum + (f.fileAsset?.size || 0), 0);
  const totalKb = (totalBytes / 1024).toFixed(1);

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm" className="h-8 px-2.5">
            <Link href={`/projects/${projectId}`} aria-label="Back to project">
              <ArrowLeft size={14} />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Projects</span>
              <span>/</span>
              <span>{projectName || `Project #${projectId.slice(0, 8)}`}</span>
              <span>/</span>
              <span>Files</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              Project Assets & Documents
            </h1>
          </div>
        </div>

        <Button asChild variant="outline" size="sm" className="h-8 text-xs">
          <Link href={`/projects/${projectId}`}>Back to Workspace</Link>
        </Button>
      </div>

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Total Attachments',
            value: String(files.length),
            note: 'project assets stored',
          },
          {
            label: 'Storage Consumed',
            value: `${totalKb} KB`,
            note: 'encrypted asset storage',
          },
          {
            label: 'Linked Deliverables',
            value: String(files.filter((f) => f.task).length),
            note: 'associated with specific tasks',
            tone: 'ok',
          },
        ]}
      />

      {/* ── Upload Panel ────────────────────────────────────────────── */}
      <Panel title="Upload New Project Document">
        <div className="max-w-2xl">{uploadFormNode}</div>
      </Panel>

      {/* ── Files Grid & Inspector ───────────────────────────────────── */}
      {files.length === 0 ? (
        <Panel pad>
          <EmptyState
            title="No project files uploaded yet"
            sub="Attach creative briefs, architecture specs, or client deliverables above."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2 min-w-0">
            <Panel title={`Project Files Register (${files.length})`}>
              <div className="bento-sales-table-head">
                <span>File Name</span>
                <span>Type</span>
                <span>Task</span>
                <span className="text-right">Size</span>
                <span className="text-right">Action</span>
              </div>

              <div className="divide-y divide-border/60">
                {files.map((file, idx) => {
                  const isSelected = activeFile?.id === file.id;
                  const name = file.fileAsset?.originalName ?? 'Unnamed file';
                  const sizeKb = file.fileAsset
                    ? `${(file.fileAsset.size / 1024).toFixed(1)} KB`
                    : '—';

                  return (
                    <button
                      key={file.id}
                      type="button"
                      onClick={() => setSelectedIdx(idx)}
                      data-active={isSelected ? 'true' : undefined}
                      className="bento-sales-table-row focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="font-semibold text-foreground text-xs truncate">{name}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          Uploaded by {file.user?.name || file.user?.email || 'System'}
                        </div>
                      </div>

                      <div className="min-w-0 pr-2 text-xs text-muted-foreground truncate">
                        {file.fileAsset?.mimeType || 'Document'}
                      </div>

                      <div className="min-w-0 pr-2 text-xs text-muted-foreground truncate">
                        {file.task?.title || 'General'}
                      </div>

                      <div className="text-xs font-mono text-muted-foreground text-right">
                        {sizeKb}
                      </div>

                      <div className="text-right">
                        <a
                          href={`/api/v1/projects/files/${encodeURIComponent(file.id)}/download`}
                          className="text-xs font-semibold text-accent hover:underline inline-flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Download size={11} /> Download
                        </a>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Panel>
          </div>

          <div className="min-w-0">
            {activeFile ? (
              <Panel
                title="File Inspector"
                action={
                  <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                    <a
                      href={`/api/v1/projects/files/${encodeURIComponent(activeFile.id)}/download`}
                    >
                      Download <Download size={11} className="ml-1" />
                    </a>
                  </Button>
                }
              >
                <div className="space-y-4 text-xs">
                  <div>
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                      Attachment Name
                    </span>
                    <h3 className="text-sm font-bold text-foreground mt-0.5 truncate">
                      {activeFile.fileAsset?.originalName ?? 'Unnamed'}
                    </h3>
                  </div>

                  <div className="border-t border-border pt-3 space-y-2.5">
                    <KeyValueRow
                      label="MIME Type"
                      value={activeFile.fileAsset?.mimeType || 'unknown'}
                    />
                    <KeyValueRow
                      label="Byte Size"
                      value={
                        activeFile.fileAsset
                          ? `${(activeFile.fileAsset.size / 1024).toFixed(1)} KB`
                          : '—'
                      }
                    />
                    <KeyValueRow
                      label="Linked Task"
                      value={activeFile.task?.title || 'None (Project level)'}
                    />
                    <KeyValueRow
                      label="Uploader"
                      value={activeFile.user?.name || activeFile.user?.email || 'System'}
                    />
                    <KeyValueRow
                      label="Upload Date"
                      value={new Date(activeFile.createdAt).toLocaleDateString()}
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
