/**
 * AgencyOS Invoice PDF export component.
 * Client component that generates a downloadable PDF invoice using jspdf.
 * Self-contained: accepts an invoiceId, fetches data from the API, exports PDF.
 */

'use client';

import { useEffect } from 'react';
import jsPDF from 'jspdf';

interface InvoicePayment {
  id: string;
  invoiceId: string;
  amount: string;
  method: string;
  reference: string | null;
  paidAt: Date | null;
  recordedBy: string | null;
  createdAt: Date;
}

interface InvoiceItem {
  id: string;
  invoiceId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  amount: string;
  createdAt: Date;
}

interface InvoiceData {
  id: string;
  number: string;
  clientId: string | null;
  title: string;
  status: string;
  subtotal: string;
  tax: string;
  total: string;
  currency: string;
  dueDate: Date | null;
  notes: string | null;
  createdAt: Date;
  creator: { id: string; name: string | null; email: string | null } | null;
  client: { id: string; firstName: string | null; lastName: string } | null;
  items: InvoiceItem[];
  payments: InvoicePayment[];
}

interface BrandingData {
  brandName?: string;
  logoUrl?: string | null;
  brandColor?: string | null;
}

interface PrintInvoiceProps {
  invoiceId: string;
}

/**
 * Load a remote logo into a data URL so jsPDF can embed it.
 *
 * Cross-origin logos may block CORS: that is a normal, non-fatal outcome — the
 * document is generated with the brand name instead of failing the export.
 */
async function loadLogo(
  url: string
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  try {
    const res = await fetch(url, { mode: 'cors', referrerPolicy: 'no-referrer' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!/^image\/(png|jpeg|jpg|webp)$/.test(blob.type)) return null;

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Could not read logo'));
      reader.readAsDataURL(blob);
    });

    const { width, height } = await new Promise<{ width: number; height: number }>(
      (resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.width, height: image.height });
        image.onerror = () => reject(new Error('Could not decode logo'));
        image.src = dataUrl;
      }
    );

    return { dataUrl, width, height };
  } catch {
    return null;
  }
}

/** `#rrggbb` → `[r, g, b]`, or null when the value is not a hex colour. */
function hexToRgbTuple(hex: string | null | undefined): [number, number, number] | null {
  if (!hex) return null;
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = match[1];
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

type WindowWithPrint = Window & {
  __printInvoice?: () => void;
};

export function PrintInvoice({ invoiceId }: PrintInvoiceProps) {
  useEffect(() => {
    async function exportPdf() {
      try {
        const res = await fetch(`/api/v1/crm/invoices/${invoiceId}`);
        if (!res.ok) throw new Error('Failed to load invoice');
        const data: InvoiceData = await res.json();

        // Branding is best-effort: a failure here must never block the export.
        const branding: BrandingData | null = await fetch('/api/v1/settings/branding')
          .then((response) => (response.ok ? response.json() : null))
          .catch(() => null);

        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 20;
        let y = margin;

        const brandColor = hexToRgbTuple(branding?.brandColor);
        const brandName = branding?.brandName?.trim();

        // Organization brand mark: logo on the right, name on the left. Both are
        // optional; the invoice heading never shifts below the document header.
        if (brandName) {
          doc.setFontSize(16);
          doc.setFont('helvetica', 'bold');
          if (brandColor) doc.setTextColor(...brandColor);
          doc.text(brandName, margin, y);
          doc.setTextColor(0, 0, 0);
        }

        if (branding?.logoUrl) {
          const logo = await loadLogo(branding.logoUrl);
          if (logo) {
            const height = 16;
            const width = Math.min((logo.width / logo.height) * height, 48);
            doc.addImage(
              logo.dataUrl,
              'PNG',
              pageWidth - margin - width,
              margin - 8,
              width,
              height
            );
          }
        }

        y += brandName ? 10 : 0;
        doc.setFontSize(20);
        doc.setFont('helvetica', 'bold');
        doc.text('INVOICE', margin, y);
        y += 10;

        doc.setFontSize(12);
        doc.setFont('helvetica', 'normal');
        doc.text(`Invoice #${data.number}`, margin, y);
        doc.text(
          `Date: ${new Date(data.createdAt).toLocaleDateString()}`,
          pageWidth - margin - 60,
          y
        );
        y += 10;

        doc.text(`Title: ${data.title}`, margin, y);
        doc.text(
          `Due: ${data.dueDate ? new Date(data.dueDate).toLocaleDateString() : '—'}`,
          pageWidth - margin - 60,
          y
        );
        y += 14;

        doc.setFont('helvetica', 'bold');
        doc.text('Client:', margin, y);
        doc.setFont('helvetica', 'normal');
        const clientName = data.client
          ? `${data.client.firstName ?? ''} ${data.client.lastName ?? ''}`.trim()
          : 'Unnamed Client';
        doc.text(clientName, margin + 25, y);
        y += 14;

        y += 2;
        doc.setFont('helvetica', 'bold');
        doc.text('Description', margin, y);
        doc.text('Qty', margin + 110, y);
        doc.text('Unit Price', margin + 140, y);
        doc.text('Tax %', margin + 170, y);
        doc.text('Amount', margin + 195, y);
        y += 8;
        doc.setDrawColor(180, 180, 180);
        doc.line(margin, y, pageWidth - margin, y);
        y += 6;

        doc.setFont('helvetica', 'normal');
        for (const item of data.items) {
          doc.text(item.description, margin, y);
          doc.text(item.quantity, margin + 110, y);
          doc.text(item.unitPrice, margin + 140, y);
          doc.text(item.taxRate, margin + 170, y);
          doc.text(item.amount, margin + 195, y);
          y += 7;
          if (y > pageHeight - 40) {
            doc.addPage();
            y = margin;
          }
        }

        y += 6;
        doc.setFont('helvetica', 'bold');
        doc.text('Subtotal:', margin + 140, y);
        doc.text(data.subtotal, margin + 195, y);
        y += 7;
        doc.text('Tax:', margin + 140, y);
        doc.text(data.tax, margin + 195, y);
        y += 7;
        doc.setFontSize(14);
        doc.text('Total:', margin + 140, y);
        doc.text(data.total, margin + 195, y);
        doc.setFontSize(12);
        y += 14;

        if (data.notes) {
          doc.setFont('helvetica', 'bold');
          doc.text('Notes:', margin, y);
          y += 7;
          doc.setFont('helvetica', 'normal');
          const splitNotes = doc.splitTextToSize(data.notes, pageWidth - 2 * margin);
          doc.text(splitNotes, margin, y);
          y += splitNotes.length * 7 + 10;
        }

        if (data.payments && data.payments.length > 0) {
          doc.setFont('helvetica', 'bold');
          doc.text('Payments:', margin, y);
          y += 7;
          doc.setFont('helvetica', 'normal');
          doc.text('Date', margin, y);
          doc.text('Method', margin + 40, y);
          doc.text('Amount', margin + 140, y);
          y += 6;
          doc.setDrawColor(180, 180, 180);
          doc.line(margin, y, pageWidth - margin, y);
          y += 6;
          for (const p of data.payments) {
            doc.text(p.paidAt ? new Date(p.paidAt).toLocaleDateString() : '—', margin, y);
            doc.text(p.method, margin + 40, y);
            doc.text(p.amount, margin + 140, y);
            y += 7;
          }
          y += 10;
        }

        doc.setFontSize(10);
        doc.setFont('helvetica', 'italic');
        doc.text(
          `Status: ${data.status}  |  Currency: ${data.currency}`,
          margin,
          pageHeight - margin
        );

        doc.save(`invoice-${data.number}.pdf`);
      } catch (err) {
        console.error('PDF export failed:', err);
        alert('Failed to export PDF');
      }
    }

    const win = window as WindowWithPrint;
    win.__printInvoice = exportPdf;
    return () => {
      delete win.__printInvoice;
    };
  }, [invoiceId]);

  return null;
}

export function printInvoice() {
  (window as WindowWithPrint).__printInvoice?.();
}
