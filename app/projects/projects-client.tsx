'use client';

import * as React from 'react';
import Link from 'next/link';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoProjectsView } from '@/components/projects/bento-projects-view';
import type { ProjectResponse } from '@/lib/services/crm/project-service';

interface ProjectsClientProps {
  projects: ProjectResponse[];
  total: number;
  totalPages: number;
  page: number;
  search: string;
  status: string;
  sortBy: string;
  sortOrder: string;
  onSearchChange: (search: string) => void;
  onStatusFilterChange: (status: string) => void;
  buildPageHref: (opts: {
    page: number;
    search?: string;
    status?: string;
    sortBy?: string;
    sortOrder?: string;
  }) => string;
}

export function ProjectsClient(props: ProjectsClientProps) {
  const isBento = useBentoShell();

  if (isBento) {
    return (
      <BentoProjectsView
        projects={props.projects}
        total={props.total}
        totalPages={props.totalPages}
        page={props.page}
        searchVal={props.search}
        statusFilter={props.status}
        sortBy={props.sortBy}
        sortOrder={props.sortOrder}
        onSearchChange={props.onSearchChange}
        onStatusFilterChange={props.onStatusFilterChange}
      />
    );
  }

  // Legacy Presentation
  const { projects, total, totalPages, page, search, status, sortBy, sortOrder, buildPageHref } =
    props;

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">Name</th>
              <th className="pb-3 font-medium">Client</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium">Budget</th>
              <th className="pb-3 font-medium">Start Date</th>
              <th className="pb-3 font-medium">End Date</th>
              <th className="pb-3 font-medium">Tasks</th>
              <th className="pb-3 font-medium">Milestones</th>
              <th className="pb-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {projects.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-8 text-muted-foreground">
                  {search || status
                    ? 'No projects match these filters.'
                    : 'No projects yet. Create your first project to get started.'}
                </td>
              </tr>
            ) : (
              projects.map((project) => (
                <tr key={project.id} className="border-b border-border hover:bg-muted/50">
                  <td className="py-4 font-medium">
                    <Link
                      href={`/projects/${project.id}`}
                      className="text-accent hover:underline font-semibold"
                    >
                      {project.name}
                    </Link>
                  </td>
                  <td className="py-4 text-sm text-muted-foreground">
                    {project.client ? (
                      <Link
                        href={`/crm/contacts/${project.client.id}`}
                        className="text-accent hover:underline"
                      >
                        {`${project.client.firstName ?? ''} ${project.client.lastName ?? ''}`.trim() ||
                          'Unnamed Client'}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-none ${
                        project.status === 'completed'
                          ? 'bg-green-100 text-green-800'
                          : project.status === 'archived'
                            ? 'bg-muted text-muted-foreground'
                            : project.status === 'on-hold'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {project.status}
                    </span>
                  </td>
                  <td className="py-4 text-sm font-medium">
                    {project.budget ? `$${project.budget}` : '—'}
                  </td>
                  <td className="py-4 text-sm text-muted-foreground">
                    {project.startDate ? new Date(project.startDate).toLocaleDateString() : '—'}
                  </td>
                  <td className="py-4 text-sm text-muted-foreground">
                    {project.endDate ? new Date(project.endDate).toLocaleDateString() : '—'}
                  </td>
                  <td className="py-4 text-sm">
                    {project.tasks.filter((t) => t.status === 'done').length}/{project.tasks.length}
                  </td>
                  <td className="py-4 text-sm">{project.milestoneCount}</td>
                  <td className="py-4 text-right">
                    <Link
                      href={`/projects/${project.id}`}
                      className="text-sm text-accent hover:underline mr-2"
                    >
                      View
                    </Link>
                    <Link
                      href={`/projects/${project.id}/edit`}
                      className="text-sm text-muted-foreground hover:text-accent transition-colors"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm text-muted-foreground">
        <span>
          {total === 0
            ? 'No projects'
            : `Showing ${(page - 1) * 20 + 1}–${Math.min(page * 20, total)} of ${total}`}
        </span>
        {totalPages > 1 && (
          <span className="flex items-center gap-2">
            {page > 1 ? (
              <Link
                href={buildPageHref({ page: page - 1, search, status, sortBy, sortOrder })}
                className="px-3 py-1.5 rounded-md border border-input hover:bg-muted"
              >
                Previous
              </Link>
            ) : null}
            <span>
              Page {page} of {totalPages}
            </span>
            {page < totalPages ? (
              <Link
                href={buildPageHref({ page: page + 1, search, status, sortBy, sortOrder })}
                className="px-3 py-1.5 rounded-md border border-input hover:bg-muted"
              >
                Next
              </Link>
            ) : null}
          </span>
        )}
      </div>
    </div>
  );
}
