/**
 * AgencyOS Projects List page.
 * Server component that lists projects for the current organization.
 */

import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { listProjects } from '@/lib/services/crm/project-service';

export default async function ProjectsListPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Next.js 16: searchParams is a Promise; filters/pagination must be read after awaiting it.
  const searchParams = await searchParamsPromise;
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    redirect('/login');
  }

  const page = Math.max(1, parseInt(String(searchParams.page ?? '1'), 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(String(searchParams.pageSize ?? '20'), 10)));
  const search = String(searchParams.search ?? '');
  const status = String(searchParams.status ?? '');
  const sortBy = String(searchParams.sortBy ?? 'createdAt');
  const sortOrder = String(searchParams.sortOrder ?? 'desc');

  const { projects, total, totalPages } = await listProjects({
    page,
    pageSize,
    search: search || undefined,
    status: status || undefined,
    sortBy: sortBy as 'name' | 'status' | 'budget' | 'createdAt' | 'updatedAt' | 'endDate',
    sortOrder: sortOrder as 'asc' | 'desc',
    includeDeleted: false,
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Projects</h1>
        <Link
          href="/projects/new"
          className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
        >
          New Project
        </Link>
      </div>

      <form className="flex flex-col sm:flex-row gap-2 max-w-2xl" action="">
        <input
          type="text"
          name="search"
          defaultValue={search}
          placeholder="Search projects by name, client..."
          className="flex-1 border border-input rounded-md px-3 py-2 text-sm"
        />
        <select
          name="status"
          defaultValue={status}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="on-hold">On Hold</option>
          <option value="completed">Completed</option>
          <option value="archived">Archived</option>
        </select>
        <button
          type="submit"
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Filter
        </button>
        {(search || status) && (
          <Link
            href="/projects"
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80 ml-2"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">Name</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium">Client</th>
              <th className="pb-3 font-medium text-right">Budget</th>
              <th className="pb-3 font-medium text-right">Tasks</th>
              <th className="pb-3 font-medium w-24">End Date</th>
              <th className="pb-3 font-medium w-24">Created</th>
              <th className="pb-3 font-medium w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {projects.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-8 text-muted-foreground">
                  No projects found. Create a project to get started.
                </td>
              </tr>
            ) : (
              projects.map(
                (project: {
                  id: string;
                  name: string;
                  status: string;
                  budget: string | null;
                  client: { id: string; firstName: string | null; lastName: string } | null;
                  tasks: Array<{ id: string }>;
                  milestoneCount: number;
                  endDate: Date | null;
                  createdAt: Date;
                }) => (
                  <tr key={project.id} className="border-b border-border hover:bg-muted/50">
                    <td className="py-4 font-medium">
                      <Link
                        href={`/projects/${project.id}`}
                        className="text-accent hover:underline"
                      >
                        {project.name}
                      </Link>
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
                    <td className="py-4">
                      {project.client ? (
                        <Link
                          href={`/crm/contacts/${project.client.id}`}
                          className="text-accent hover:underline text-sm"
                        >
                          {`${project.client.firstName ?? ''} ${project.client.lastName ?? ''}`.trim() ||
                            'Unnamed Client'}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </td>
                    <td className="py-4 text-right text-sm font-medium">
                      {project.budget ? `$${Number(project.budget).toLocaleString()}` : '—'}
                    </td>
                    <td className="py-4 text-right text-sm">{project.tasks.length}</td>
                    <td className="py-4 text-sm text-muted-foreground">
                      {project.endDate ? new Date(project.endDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="py-4 text-sm text-muted-foreground">
                      {new Date(project.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-4 text-right">
                      <Link
                        href={`/projects/${project.id}`}
                        className="text-sm text-accent hover:underline mr-2"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                )
              )
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          Page {page} of {totalPages} ({total} total)
        </div>
      )}
    </div>
  );
}
