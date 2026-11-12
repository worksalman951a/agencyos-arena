import { jsPDF } from 'jspdf';
import type { InvoiceResponse } from '@/lib/services/crm/invoice-service';
import type { EstimateResponse } from '@/lib/services/crm/estimate-service';

export interface PdfBranding {
  brandName?: string | null;
  brandColor?: string | null;
  logoUrl?: string | null;
}

/**
 * Format currency amounts cleanly and safely without floating-point math drift.
 */
function formatCurrency(amount: string | number, currency = 'USD'): string {
  const num = typeof amount === 'number' ? amount : parseFloat(amount);
  if (isNaN(num)) return `${currency} 0.00`;
  return `${currency} ${num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return 'N/A';
  const d = new Date(date);
  return isNaN(d.getTime())
    ? 'N/A'
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Generates an authoritative server-side PDF document for an Invoice.
 * Returns raw Uint8Array / Buffer bytes.
 */
export function generateInvoicePdf(invoice: InvoiceResponse, branding?: PdfBranding): Uint8Array {
  const doc = new jsPDF({
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;

  let y = margin + 20;

  // Header / Branding
  const brandName = branding?.brandName || 'AgencyOS';
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(30, 41, 59); // slate-800
  doc.text(brandName, margin, y);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(15, 23, 42); // slate-900
  doc.text('INVOICE', pageWidth - margin, y, { align: 'right' });

  y += 24;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139); // slate-500
  doc.text(`Invoice Number: ${invoice.number}`, pageWidth - margin, y, { align: 'right' });

  y += 14;
  doc.text(`Status: ${invoice.status.toUpperCase()}`, pageWidth - margin, y, { align: 'right' });

  y += 20;
  // Divider
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.setLineWidth(1);
  doc.line(margin, y, pageWidth - margin, y);

  y += 25;

  // Metadata Columns: Bill To & Dates
  const col2X = margin + contentWidth * 0.55;

  // Left Column: Bill To
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105); // slate-600
  doc.text('BILL TO', margin, y);

  doc.setFont('helvetica', 'bold');
  doc.text('PAYMENT DETAILS', col2X, y);

  y += 15;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);

  const clientName = invoice.client
    ? `${invoice.client.firstName || ''} ${invoice.client.lastName || ''}`.trim() || 'Valued Client'
    : 'Valued Client';
  doc.text(clientName, margin, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105);
  doc.text(`Issue Date: ${formatDate(invoice.createdAt)}`, col2X, y);

  y += 14;
  doc.text(invoice.title ? `Project: ${invoice.title}` : 'General Consulting Services', margin, y);
  doc.text(`Due Date: ${formatDate(invoice.dueDate)}`, col2X, y);

  y += 30;

  // Line Items Table Header
  const colDesc = margin;
  const colQty = margin + contentWidth * 0.52;
  const colUnitPrice = margin + contentWidth * 0.68;
  const colAmount = pageWidth - margin;

  doc.setFillColor(248, 250, 252); // slate-50
  doc.rect(margin, y, contentWidth, 22, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);

  const tableHeaderY = y + 15;
  doc.text('ITEM DESCRIPTION', colDesc + 8, tableHeaderY);
  doc.text('QTY', colQty, tableHeaderY, { align: 'right' });
  doc.text('UNIT PRICE', colUnitPrice, tableHeaderY, { align: 'right' });
  doc.text('AMOUNT', colAmount - 8, tableHeaderY, { align: 'right' });

  y += 28;

  // Table Rows
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(30, 41, 59);

  const items = invoice.items || [];
  if (items.length === 0) {
    doc.text('No line items specified.', colDesc + 8, y + 10);
    y += 25;
  } else {
    for (const item of items) {
      if (y > pageHeight - 120) {
        doc.addPage();
        y = margin + 20;
      }

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(30, 41, 59);

      // Description wrap
      const descLines = doc.splitTextToSize(item.description || 'Line item', contentWidth * 0.48);
      doc.text(descLines, colDesc + 8, y + 10);

      doc.text(String(item.quantity ?? '1'), colQty, y + 10, { align: 'right' });
      doc.text(formatCurrency(item.unitPrice, invoice.currency), colUnitPrice, y + 10, {
        align: 'right',
      });
      doc.text(formatCurrency(item.amount, invoice.currency), colAmount - 8, y + 10, {
        align: 'right',
      });

      const rowHeight = Math.max(20, descLines.length * 12 + 8);
      doc.setDrawColor(241, 245, 249); // slate-100
      doc.line(margin, y + rowHeight, pageWidth - margin, y + rowHeight);
      y += rowHeight + 4;
    }
  }

  y += 15;

  // Totals Area (Subtotal, Tax, Total)
  if (y > pageHeight - 130) {
    doc.addPage();
    y = margin + 20;
  }

  const totalsLabelX = margin + contentWidth * 0.65;
  const totalsValX = pageWidth - margin - 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);

  doc.text('Subtotal:', totalsLabelX, y, { align: 'right' });
  doc.text(formatCurrency(invoice.subtotal, invoice.currency), totalsValX, y, { align: 'right' });

  if (parseFloat(invoice.tax) > 0) {
    y += 16;
    doc.text('Tax:', totalsLabelX, y, { align: 'right' });
    doc.text(formatCurrency(invoice.tax, invoice.currency), totalsValX, y, { align: 'right' });
  }

  y += 18;
  doc.setDrawColor(226, 232, 240);
  doc.line(totalsLabelX - 50, y - 6, pageWidth - margin, y - 6);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text('Total Due:', totalsLabelX, y + 6, { align: 'right' });
  doc.text(formatCurrency(invoice.total, invoice.currency), totalsValX, y + 6, { align: 'right' });

  y += 30;

  // Notes & Payment History
  if (invoice.notes) {
    if (y > pageHeight - 100) {
      doc.addPage();
      y = margin + 20;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text('NOTES & TERMS', margin, y);

    y += 12;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    const noteLines = doc.splitTextToSize(invoice.notes, contentWidth);
    doc.text(noteLines, margin, y);
    y += noteLines.length * 12 + 15;
  }

  // Footer / Page numbers
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184); // slate-400
    doc.text(
      `Generated by ${brandName} · Page ${i} of ${totalPages}`,
      pageWidth / 2,
      pageHeight - 20,
      { align: 'center' }
    );
  }

  return new Uint8Array(doc.output('arraybuffer'));
}

/**
 * Generates an authoritative server-side PDF document for an Estimate.
 * Returns raw Uint8Array / Buffer bytes.
 */
export function generateEstimatePdf(
  estimate: EstimateResponse,
  branding?: PdfBranding
): Uint8Array {
  const doc = new jsPDF({
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;

  let y = margin + 20;

  // Header / Branding
  const brandName = branding?.brandName || 'AgencyOS';
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(30, 41, 59);
  doc.text(brandName, margin, y);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(15, 23, 42);
  doc.text('ESTIMATE / QUOTE', pageWidth - margin, y, { align: 'right' });

  y += 24;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(`Estimate Number: ${estimate.number}`, pageWidth - margin, y, { align: 'right' });

  y += 14;
  doc.text(`Status: ${estimate.status.toUpperCase()}`, pageWidth - margin, y, { align: 'right' });

  y += 20;
  // Divider
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(1);
  doc.line(margin, y, pageWidth - margin, y);

  y += 25;

  // Metadata Columns: Prepared For & Dates
  const col2X = margin + contentWidth * 0.55;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105);
  doc.text('PREPARED FOR', margin, y);
  doc.text('ESTIMATE DETAILS', col2X, y);

  y += 15;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);

  const clientName = estimate.client
    ? `${estimate.client.firstName || ''} ${estimate.client.lastName || ''}`.trim() ||
      'Valued Client'
    : 'Valued Client';
  doc.text(clientName, margin, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105);
  doc.text(`Date Issued: ${formatDate(estimate.createdAt)}`, col2X, y);

  y += 14;
  if (estimate.client?.email) {
    doc.text(estimate.client.email, margin, y);
  }
  doc.text(`Valid Until: ${formatDate(estimate.validUntil)}`, col2X, y);

  y += 35;

  // Estimate Summary Box
  doc.setFillColor(248, 250, 252);
  doc.rect(margin, y, contentWidth, 50, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.rect(margin, y, contentWidth, 50, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(71, 85, 105);
  doc.text('Estimated Engagement Investment', margin + 15, y + 22);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text(formatCurrency(estimate.total, estimate.currency), pageWidth - margin - 15, y + 32, {
    align: 'right',
  });

  y += 75;

  // Notes & Commercial Terms
  if (estimate.notes) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(71, 85, 105);
    doc.text('SCOPE OF WORK & TERMS', margin, y);

    y += 15;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    const noteLines = doc.splitTextToSize(estimate.notes, contentWidth);
    doc.text(noteLines, margin, y);
    y += noteLines.length * 12 + 20;
  }

  // Footer / Page numbers
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Generated by ${brandName} · Page ${i} of ${totalPages}`,
      pageWidth / 2,
      pageHeight - 20,
      { align: 'center' }
    );
  }

  return new Uint8Array(doc.output('arraybuffer'));
}
