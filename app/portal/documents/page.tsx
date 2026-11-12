import { listClientPortalDocuments } from '@/lib/services/portal/portal-data-service';
import { ClientPortalDocumentsClient } from '@/components/portal/client-portal-documents-client';

export default async function ClientPortalDocumentsPage() {
  const documents = await listClientPortalDocuments();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Proposals, Quotations & Contracts
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Review commercial proposals, scopes of work, and electronically accept authorized
            agreements.
          </p>
        </div>
      </div>

      <ClientPortalDocumentsClient documents={documents} />
    </div>
  );
}
