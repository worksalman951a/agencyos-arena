/**
 * AgencyOS Projects List page.
 * Server component that lists projects for the current organization.
 */

import Link from 'next/link';
import { listProjects } from '@/lib/services/crm/project-service';
import { projectQuerySchema } from '@/lib/schemas/crm/project.schema';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';

function buildPageHref(queryOpts: {
  page: number;
  search?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: string;
}) {
  const qs = new URLSearchParams();
  if (queryOpts.page > 1) qs.set('page', String(queryOpts.page));
  if (queryOpts.search) qs.set('search', queryOpts.search);
  if (queryOpts.status) qs.set('status', queryOpts.status);
  if (queryOpts.sortBy && queryOpts.sortBy !== 'createdAt') qs.set('sortBy', queryOpts.sortBy);
  if (queryOpts.sortOrder && queryOpts.sortOrder !== 'desc') {
    qs.set('sortOrder', queryOpts.sortOrder);
  }
  const query = qs.toString();
  return query ? `/projects?${query}` : '/projects';
}

export default async function ProjectsListPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const searchParams = await searchParamsPromise;

  const rawSearch = Array.isArray(searchParams.search)
    ? searchParams.search[0]
    : searchParams.search;
  const rawStatus = Array.isArray(searchParams.status)
    ? searchParams.status[0]
    : searchParams.status;
  const rawSortBy = Array.isArray(searchParams.sortBy)
    ? searchParams.sortBy[0]
    : searchParams.sortBy;
  const rawSortOrder = Array.isArray(searchParams.sortOrder)
    ? searchParams.sortOrder[0]
    : searchParams.sortOrder;
  const rawPage = Array.isArray(searchParams.page) ? searchParams.page[0] : searchParams.page;
  const rawPageSize = Array.isArray(searchParams.pageSize)
    ? searchParams.pageSize[0]
    : searchParams.pageSize;

  const parsedQuery = projectQuerySchema.safeParse({
    page: rawPage,
    pageSize: rawPageSize,
    search: rawSearch?.trim() || undefined,
    status: rawStatus || undefined,
    sortBy: rawSortBy || undefined,
    sortOrder: rawSortOrder || undefined,
    includeDeleted: false,
  });

  const query = parsedQuery.success
    ? parsedQuery.data
    : {
        page: 1,
        pageSize: 20,
        search: undefined,
        status: undefined,
        sortBy: 'createdAt' as const,
        sortOrder: 'desc' as const,
        includeDeleted: false,
      };

  const result = await loadPageData(() => listProjects(query));

  if (!result.ok) {
    return <PageStateNotice reason={result.reason} />;
  }

  const { projects, total, totalPages, page } = result.data;
  const search = query.search ?? '';
  const status = query.status ?? '';
  const sortBy = query.sortBy;
  const sortOrder = query.sortOrder;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Projects</h1>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/projects/templates"
            className="px-4 py-2 bg-muted text-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Templates
          </Link>
          <Link
            href="/projects/new"
            className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
          >
            New Project
          </Link>
        </div>
      </div>

      <form className="flex flex-col sm:flex-row flex-wrap gap-2 max-w-4xl" action="/projects">
        <input
          type="text"
          name="search"
          defaultValue={search}
          placeholder="Search projects by name, client, account..."
          className="flex-1 min-w-[200px] border border-input rounded-md px-3 py-2 text-sm bg-background"
        />
        <select
          name="status"
          defaultValue={status}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background"
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="on-hold">On Hold</option>
          <option value="completed">Completed</option>
          <option value="archived">Archived</option>
        </select>
        <select
          name="sortBy"
          defaultValue={sortBy}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background"
          aria-label="Sort by"
        >
          <option value="createdAt">Created</option>
          <option value="updatedAt">Updated</option>
          <option value="name">Name</option>
          <option value="status">Status</option>
          <option value="budget">Budget</option>
          <option value="endDate">End Date</option>
        </select>
        <select
          name="sortOrder"
          defaultValue={sortOrder}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background"
          aria-label="Sort order"
        >
          <option value="desc">Desc</option>
          <option value="asc">Asc</option>
        </select>
        <button
          type="submit"
          className="px-4 py-2 bg-muted text-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Filter
        </button>
        {(search || status || sortBy !== 'createdAt' || sortOrder !== 'desc') && (
          <Link
            href="/projects"
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
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
              <th className="pb-3 font-medium text-right">Progress</th>
              <th className="pb-3 font-medium w-28">End Date</th>
              <th className="pb-3 font-medium w-28">Created</th>
              <th className="pb-3 font-medium w-36 text-right">Actions</th>
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
              projects.map((project) => {
                const doneTasks = project.tasks.filter((t) => t.status === 'done').length;
                const totalTasks = project.tasks.length;
                return (
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
                        <div className="text-sm">
                          <Link
                            href={`/crm/contacts/${project.client.id}`}
                            className="text-accent hover:underline"
                          >
                            {`${project.client.firstName ?? ''} ${project.client.lastName ?? ''}`.trim() ||
                              'Unnamed Client'}
                          </Link>
                          {project.client.account && (
                            <div className="text-xs text-muted-foreground">
                              {project.client.account.name}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">Internal</span>
                      )}
                    </td>
                    <td className="py-4 text-right text-sm font-medium">
                      {project.budget ? `$${Number(project.budget).toLocaleString()}` : '—'}
                    </td>
                    <td className="py-4 text-right text-sm">
                      {totalTasks > 0
                        ? `${doneTasks}/${totalTasks} tasks`
                        : `${project.milestoneCount} milestone${project.milestoneCount === 1 ? '' : 's'}`}
                    </td>
                    <td className="py-4 text-sm text-muted-foreground">
                      {project.endDate ? new Date(project.endDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="py-4 text-sm text-muted-foreground">
                      {new Date(project.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-4 text-right whitespace-nowrap">
                      <Link
                        href={`/projects/${project.id}`}
                        className="text-sm text-accent hover:underline mr-3"
                      >
                        View
                      </Link>
                      <Link
                        href={`/projects/${project.id}/edit`}
                        className="text-sm text-muted-foreground hover:underline"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
          <span>
            Page {page} of {totalPages} ({total} total)
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={buildPageHref({ page: page - 1, search, status, sortBy, sortOrder })}
                className="px-3 py-1.5 rounded-md border border-input bg-background hover:bg-muted"
              >
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={buildPageHref({ page: page + 1, search, status, sortBy, sortOrder })}
                className="px-3 py-1.5 rounded-md border border-input bg-background hover:bg-muted"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
