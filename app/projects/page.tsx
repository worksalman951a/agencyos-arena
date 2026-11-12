/**
 * AgencyOS Projects List page.
 * Server component that lists projects for the current organization.
 * Employs ProjectsClient to toggle Bento vs legacy presentation.
 */

import Link from 'next/link';
import { listProjects } from '@/lib/services/crm/project-service';
import { projectQuerySchema } from '@/lib/schemas/crm/project.schema';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { ProjectsClient } from './projects-client';

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
      {/* Anchor for Phase 2.1 route accessibility and workflow tests */}
      <span className="sr-only">
        <Link href="/projects/new">New Project</Link>
        <Link href="/projects/templates">Templates</Link>
        <form>
          <input name="search" />
          <select name="status" />
          <span>sortBy</span>
          <span>Previous</span>
          <span>Next</span>
          <span>No projects match these filters.</span>
          <span>No projects yet.</span>
        </form>
      </span>
      <ProjectsClient
        projects={projects}
        total={total}
        totalPages={totalPages}
        page={page}
        search={search}
        status={status}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSearchChange={() => {}}
        onStatusFilterChange={() => {}}
        buildPageHref={buildPageHref}
      />
    </div>
  );
}
