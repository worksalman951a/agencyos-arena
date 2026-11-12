'use client';

import * as React from 'react';
import { Download, Printer, Loader2 } from 'lucide-react';

export function SharedDocumentPrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors print:hidden shadow-xs"
    >
      <Printer size={14} className="text-slate-500" />
      <span>Print</span>
    </button>
  );
}

export function SharedDocumentDownloadPdfButton({ token }: { token: string }) {
  const [downloading, setDownloading] = React.useState(false);

  const handleDownload = async () => {
    try {
      setDownloading(true);
      const res = await fetch(`/api/v1/documents/links/${token}/pdf`);
      if (!res.ok) {
        throw new Error(`Failed to download PDF (${res.status})`);
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const disposition = res.headers.get('content-disposition');
      let filename = 'Shared_Document.pdf';

      if (disposition) {
        const match = disposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) filename = match[1];
      }

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      // Graceful fallback to browser print if download route fails
      window.print();
    } finally {
      setDownloading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={downloading}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800 disabled:opacity-50 transition-colors print:hidden shadow-xs"
    >
      {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
      <span>{downloading ? 'Downloading...' : 'Download PDF'}</span>
    </button>
  );
}
