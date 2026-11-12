'use client';

import { PrintInvoice, printInvoice } from './print-invoice';
import { Download } from 'lucide-react';

/**
 * "Export PDF" action for an invoice.
 *
 * Provides direct server-rendered PDF download via `/api/v1/crm/invoices/[id]/pdf`
 * while maintaining window print fallback compatibility.
 */
export function ExportPdfButton({ invoiceId }: { invoiceId: string }) {
  return (
    <div className="inline-flex items-center gap-2">
      <PrintInvoice invoiceId={invoiceId} />
      <a
        href={`/api/v1/crm/invoices/${encodeURIComponent(invoiceId)}/pdf`}
        download
        data-testid="export-pdf-server-button"
        className="inline-flex items-center gap-1.5 px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
      >
        <Download className="h-4 w-4" />
        Download PDF
      </a>
      <button
        type="button"
        onClick={() => printInvoice()}
        className="px-3 py-2 border border-border bg-background text-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        title="Open client print/preview generator"
      >
        Print Preview
      </button>
    </div>
  );
}
