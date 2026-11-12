/**
 * AgencyOS Edit Time Entry page.
 * Resolves permissions and ownership context on the server, then renders the
 * interactive entry editor.
 */

import { getCurrentPermissions } from '@/lib/current-user';
import { getTimeEntriesAccessContext } from '@/lib/services/projects/time-entry-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { EditTimeEntryForm } from './EditTimeEntryForm';

export default async function EditTimeEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, contextResult, permissions] = await Promise.all([
    params,
    loadPageData(() => getTimeEntriesAccessContext()),
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

  return (
    <EditTimeEntryForm
      entryId={id}
      currentUserId={contextResult.data.currentUserId}
      isAdmin={contextResult.data.isAdmin}
      canUpdate={permissions.has('time.entry.update')}
      canDelete={permissions.has('time.entry.delete')}
      defaultCurrency={contextResult.data.defaultCurrency}
    />
  );
}
