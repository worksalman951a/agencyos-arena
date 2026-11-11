/**
 * AgencyOS Documents - Shareable Links
 * Server component that lists shareable document links for the current organization.
 */

import { listDocumentLinks } from '@/lib/services/documents/link-service';
import { loadPageData } from '@/lib/page-data';
import { PageStateNotice } from '@/components/server/page-state-notice';
import { LinksPageClient, type DocumentLinkItem } from './LinksPageClient';

export default async function DocumentLinksPage() {
  const result = await loadPageData(() => listDocumentLinks());

  if (!result.ok) {
    return <PageStateNotice reason={result.reason} />;
  }

  return (
    <div className="p-6">
      <LinksPageClient initialLinks={result.data as DocumentLinkItem[]} />
    </div>
  );
}
