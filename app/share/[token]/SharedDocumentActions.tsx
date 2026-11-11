'use client';

export function SharedDocumentPrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="px-4 py-2 rounded-md border border-slate-300 bg-white text-slate-800 text-sm font-medium hover:bg-slate-50 print:hidden"
    >
      Print / Save as PDF
    </button>
  );
}
