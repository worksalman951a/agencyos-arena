'use client';

import { PrintInvoice, printInvoice } from './print-invoice';

/**
 * "Export PDF" action for an invoice.
 *
 * `PrintInvoice` registers the jsPDF generator on the window object on mount;
 * this button triggers it. Both must live in a Client Component — the invoice
 * detail page previously rendered the button (and its `onClick`) inside a
 * Server Component, where handlers cannot be serialised.
 */
export function ExportPdfButton({ invoiceId }: { invoiceId: string }) {
  return (
    <>
      <PrintInvoice invoiceId={invoiceId} />
      <button
        type="button"
        onClick={() => printInvoice()}
        className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
      >
        Export PDF
      </button>
    </>
  );
}
