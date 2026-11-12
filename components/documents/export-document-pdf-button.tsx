'use client';

import { useState } from 'react';
import jsPDF from 'jspdf';
import { Download } from 'lucide-react';
import { useBranding } from '@/components/providers/branding-provider';

export interface PrintableLineItem {
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  amount: string;
}

export interface ExportDocumentPdfProps {
  documentKind: 'PROPOSAL' | 'QUOTATION' | 'ESTIMATE' | 'CONTRACT';
  documentId?: string | null;
  number?: string | null;
  title: string;
  status: string;
  currency?: string | null;
  createdAt?: string | Date | null;
  validUntil?: string | Date | null;
  clientName?: string | null;
  opportunityTitle?: string | null;
  projectName?: string | null;
  subtotal?: string | null;
  tax?: string | null;
  total?: string | null;
  notes?: string | null;
  items?: PrintableLineItem[];
  signedAt?: string | Date | null;
  signerName?: string | null;
  signatureReference?: string | null;
  brandingOverride?: {
    brandName?: string;
    brandColor?: string | null;
    logoUrl?: string | null;
  } | null;
}

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

function formatMoney(value: string | null | undefined, currency?: string | null): string {
  const num = Number(value ?? 0);
  const formatted = Number.isFinite(num)
    ? num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : String(value ?? '0.00');
  return currency ? `${currency} ${formatted}` : formatted;
}

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString();
}

export function ExportDocumentPdfButton(props: ExportDocumentPdfProps) {
  const shellBranding = useBranding();
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    try {
      let branding = props.brandingOverride ?? shellBranding;
      if (!branding) {
        branding = await fetch('/api/v1/settings/branding')
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null);
      }

      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 18;
      const rightEdge = pageWidth - margin;
      let y = margin;

      const brandColor = hexToRgbTuple(branding?.brandColor);
      const brandName = branding?.brandName?.trim() || 'AgencyOS';

      doc.setFontSize(15);
      doc.setFont('helvetica', 'bold');
      if (brandColor) doc.setTextColor(...brandColor);
      doc.text(brandName, margin, y);
      doc.setTextColor(0, 0, 0);

      if (branding?.logoUrl) {
        const logo = await loadLogo(branding.logoUrl);
        if (logo) {
          const height = 14;
          const width = Math.min((logo.width / logo.height) * height, 44);
          doc.addImage(logo.dataUrl, 'PNG', rightEdge - width, margin - 6, width, height);
        }
      }

      y += 10;
      doc.setFontSize(19);
      doc.setFont('helvetica', 'bold');
      doc.text(props.documentKind, margin, y);
      y += 8;

      doc.setFontSize(10.5);
      doc.setFont('helvetica', 'normal');
      if (props.number) {
        doc.text(`Number: #${props.number}`, margin, y);
      }
      doc.text(`Status: ${props.status.toUpperCase()}`, rightEdge, y, { align: 'right' });
      y += 6;

      doc.text(`Title: ${props.title}`, margin, y);
      if (props.createdAt) {
        doc.text(`Issued: ${formatDate(props.createdAt)}`, rightEdge, y, { align: 'right' });
      }
      y += 6;

      if (props.validUntil) {
        doc.text(`Valid Until: ${formatDate(props.validUntil)}`, margin, y);
        y += 6;
      }

      if (props.clientName) {
        doc.text(`Client: ${props.clientName}`, margin, y);
        y += 6;
      }
      if (props.opportunityTitle) {
        doc.text(`Opportunity: ${props.opportunityTitle}`, margin, y);
        y += 6;
      }
      if (props.projectName) {
        doc.text(`Project: ${props.projectName}`, margin, y);
        y += 6;
      }

      y += 4;
      doc.setDrawColor(200, 200, 200);
      doc.line(margin, y, rightEdge, y);
      y += 8;

      if (props.items && props.items.length > 0) {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('Description', margin, y);
        doc.text('Qty', margin + 96, y, { align: 'right' });
        doc.text('Unit Price', margin + 128, y, { align: 'right' });
        doc.text('Tax %', margin + 148, y, { align: 'right' });
        doc.text('Amount', rightEdge, y, { align: 'right' });
        y += 3;
        doc.line(margin, y, rightEdge, y);
        y += 6;

        doc.setFont('helvetica', 'normal');
        for (const item of props.items) {
          const wrapped = doc.splitTextToSize(item.description || '—', 82) as string[];
          if (y + wrapped.length * 5 > pageHeight - 36) {
            doc.addPage();
            y = margin;
          }
          doc.text(wrapped, margin, y);
          doc.text(String(item.quantity), margin + 96, y, { align: 'right' });
          doc.text(formatMoney(item.unitPrice, props.currency), margin + 128, y, {
            align: 'right',
          });
          doc.text(`${Number(item.taxRate || 0).toFixed(2)}%`, margin + 148, y, {
            align: 'right',
          });
          doc.text(formatMoney(item.amount, props.currency), rightEdge, y, { align: 'right' });
          y += Math.max(6, wrapped.length * 5 + 2);
        }

        y += 4;
        doc.line(margin + 100, y, rightEdge, y);
        y += 6;
      }

      if (props.total !== undefined && props.total !== null) {
        doc.setFontSize(10.5);
        if (props.subtotal !== undefined && props.subtotal !== null) {
          doc.setFont('helvetica', 'normal');
          doc.text('Subtotal:', margin + 128, y, { align: 'right' });
          doc.text(formatMoney(props.subtotal, props.currency), rightEdge, y, { align: 'right' });
          y += 6;
        }
        if (props.tax !== undefined && props.tax !== null) {
          doc.setFont('helvetica', 'normal');
          doc.text('Tax:', margin + 128, y, { align: 'right' });
          doc.text(formatMoney(props.tax, props.currency), rightEdge, y, { align: 'right' });
          y += 6;
        }
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('Total:', margin + 128, y, { align: 'right' });
        doc.text(formatMoney(props.total, props.currency), rightEdge, y, { align: 'right' });
        y += 10;
      }

      if (props.signedAt || props.signerName || props.signatureReference) {
        if (y > pageHeight - 45) {
          doc.addPage();
          y = margin;
        }
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text('Signature Record', margin, y);
        y += 6;
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        if (props.signerName) {
          doc.text(`Signed By: ${props.signerName}`, margin, y);
          y += 5;
        }
        if (props.signedAt) {
          doc.text(`Signed At: ${formatDate(props.signedAt)}`, margin, y);
          y += 5;
        }
        if (props.signatureReference) {
          doc.text(`Reference: ${props.signatureReference}`, margin, y);
          y += 5;
        }
        y += 5;
      }

      if (props.notes) {
        if (y > pageHeight - 45) {
          doc.addPage();
          y = margin;
        }
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text('Notes & Terms', margin, y);
        y += 6;
        doc.setFontSize(9.5);
        doc.setFont('helvetica', 'normal');
        const noteLines = doc.splitTextToSize(props.notes, pageWidth - margin * 2) as string[];
        doc.text(noteLines, margin, y);
      }

      const fileSlug = (props.number || props.title || props.documentKind)
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase();
      doc.save(`${props.documentKind.toLowerCase()}-${fileSlug || 'document'}.pdf`);
    } finally {
      setExporting(false);
    }
  }

  if (props.documentKind === 'ESTIMATE' && props.documentId) {
    return (
      <a
        href={`/api/v1/finance/estimates/${encodeURIComponent(props.documentId)}/pdf`}
        download
        data-testid="export-pdf-button"
        className="inline-flex items-center gap-1.5 px-3 py-2 border border-border bg-background text-foreground rounded-md text-sm font-medium hover:bg-muted/80"
      >
        <Download className="h-4 w-4" />
        Download PDF
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={exporting}
      data-testid="export-pdf-button"
      className="inline-flex items-center gap-1.5 px-3 py-2 border border-border bg-background text-foreground rounded-md text-sm font-medium hover:bg-muted/80 disabled:opacity-50"
    >
      <Download className="h-4 w-4" />
      {exporting ? 'Exporting…' : 'Export PDF'}
    </button>
  );
}
