/**
 * AgencyOS Log Time page.
 * Resolves permissions and organization defaults on the server and renders
 * the interactive time-entry creation form.
 */

import { Suspense } from 'react';
import { getCurrentPermissions } from '@/lib/current-user';
import { getTimeEntryFormContext } from '@/lib/services/projects/time-entry-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { NewTimeEntryForm } from './NewTimeEntryForm';

export default async function LogTimePage() {
  const [contextResult, permissions] = await Promise.all([
    loadPageData(() => getTimeEntryFormContext()),
    getCurrentPermissions(),
  ]);

  if (!contextResult.ok) {
    return (
      <PageStateNotice
        reason={contextResult.reason}
        backHref="/projects/time-entries"
        backLabel="Back to time entries"
      />
    );
  }

  if (!permissions.has('time.entry.create')) {
    return (
      <PageStateNotice
        reason="forbidden"
        backHref="/projects/time-entries"
        backLabel="Back to time entries"
      />
    );
  }

  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading form…</div>}>
      <NewTimeEntryForm
        defaultCurrency={contextResult.data.defaultCurrency}
        isAdmin={contextResult.data.isAdmin}
      />
    </Suspense>
  );
}
