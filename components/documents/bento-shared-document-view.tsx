'use client';

import * as React from 'react';
import { ShieldCheck, CheckCircle2 } from 'lucide-react';
import { SharedDocumentPrintButton } from '@/app/share/[token]/SharedDocumentActions';
import '@/components/crm/bento-contacts.css';

interface LineItem {
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  amount: string;
}

interface SharedDocumentPublicSnapshot {
  entityType?: 'proposal' | 'quotation' | 'estimate' | 'contract';
  number?: string | null;
  title: string;
  status: string;
  currency?: string | null;
  validUntil?: string | null;
  subtotal?: string | null;
  tax?: string | null;
  total?: string | null;
  notes?: string | null;
  clientName?: string | null;
  signedAt?: string | null;
  signatureReference?: string | null;
  items?: LineItem[];
  branding?: {
    brandName?: string | null;
    brandColor?: string | null;
  } | null;
}

export interface BentoSharedDocumentViewProps {
  documentTitle: string;
  documentType: string;
  expiresAt: Date | string;
  accessCount: number;
  maxAccess: number | null;
  snapshot: SharedDocumentPublicSnapshot | null;
  token: string;
}

export function BentoSharedDocumentView({
  documentTitle,
  documentType,
  expiresAt,
  snapshot,
}: BentoSharedDocumentViewProps) {
  const branding = snapshot?.branding ?? null;
  const brandName = branding?.brandName || 'AgencyOS';
  const entityKind = String(snapshot?.entityType ?? documentType ?? 'document').toUpperCase();
  const displayTitle = snapshot?.title || documentTitle;
  const number = snapshot?.number ?? null;
  const status = snapshot?.status ?? null;
  const currency = snapshot?.currency || 'USD';
  const clientName = snapshot?.clientName ?? null;
  const validUntil = snapshot?.validUntil ?? null;
  const notes = snapshot?.notes ?? null;
  const subtotal = snapshot?.subtotal ? Number(snapshot.subtotal) : null;
  const tax = snapshot?.tax ? Number(snapshot.tax) : null;
  const total = snapshot?.total ? Number(snapshot.total) : null;
  const items = snapshot?.items ?? [];
  const signedAt = snapshot?.signedAt ?? null;
  const signatureReference = snapshot?.signatureReference ?? null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-between">
      {/* ── Public Branded Top Bar ──────────────────────────────────── */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-teal-700 text-white font-bold flex items-center justify-center text-sm shadow-sm">
            {brandName.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="font-bold text-sm tracking-tight text-slate-900">{brandName}</div>
            <div className="text-[11px] text-slate-500 flex items-center gap-1">
              <ShieldCheck size={12} className="text-teal-600" />
              <span>Shared securely via AgencyOS &bull; Authenticated read-only copy</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <SharedDocumentPrintButton />
        </div>
      </header>

      {/* ── Document Container ──────────────────────────────────────── */}
      <main className="max-w-4xl w-full mx-auto p-6 md:p-10 my-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 md:p-12 space-y-8">
          {/* Header Title & Ref */}
          <div className="border-b border-slate-100 pb-6 flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-teal-700 uppercase tracking-wider">
                <span>{entityKind}</span>
                {number && <span>#{number}</span>}
              </div>
              <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 mt-1">
                {displayTitle}
              </h1>
              {clientName && (
                <p className="text-xs text-slate-500 mt-1">
                  Prepared for <span className="font-semibold text-slate-700">{clientName}</span>
                </p>
              )}
            </div>

            <div className="text-right flex md:flex-col items-center md:items-end justify-between gap-2">
              {status && (
                <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase bg-slate-100 text-slate-800 border border-slate-200">
                  {status}
                </span>
              )}
              {validUntil && (
                <span className="text-xs text-slate-500">
                  Valid until {new Date(validUntil).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>

          {/* Line Items Table if present */}
          {items.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Deliverables & Pricing
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 uppercase font-semibold text-[11px]">
                      <th className="py-2.5">Description</th>
                      <th className="py-2.5 text-center w-16">Qty</th>
                      <th className="py-2.5 text-right w-28">Unit Price</th>
                      <th className="py-2.5 text-right w-28">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((it, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        <td className="py-3 font-medium text-slate-800">{it.description}</td>
                        <td className="py-3 text-center text-slate-600">{it.quantity}</td>
                        <td className="py-3 text-right text-slate-600">
                          {currency}{' '}
                          {Number(it.unitPrice).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td className="py-3 text-right font-semibold text-slate-900">
                          {currency}{' '}
                          {Number(it.amount).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Financial Totals */}
              <div className="flex justify-end pt-4 border-t border-slate-100">
                <div className="w-64 space-y-2 text-xs">
                  {subtotal !== null && (
                    <div className="flex justify-between text-slate-600">
                      <span>Subtotal</span>
                      <span>
                        {currency}{' '}
                        {subtotal.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                  )}
                  {tax !== null && tax > 0 && (
                    <div className="flex justify-between text-slate-600">
                      <span>Estimated Tax</span>
                      <span>
                        {currency}{' '}
                        {tax.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                  )}
                  {total !== null && (
                    <div className="flex justify-between font-bold text-sm text-slate-900 border-t border-slate-200 pt-2">
                      <span>Total Value</span>
                      <span className="text-teal-700">
                        {currency}{' '}
                        {total.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Notes or Scope of Work */}
          {notes && (
            <div className="space-y-2 pt-4 border-t border-slate-100">
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Notes & Terms of Agreement
              </h2>
              <div className="text-xs text-slate-700 bg-slate-50 p-4 rounded-lg border border-slate-200 whitespace-pre-wrap leading-relaxed">
                {notes}
              </div>
            </div>
          )}

          {/* Execution details for Contracts */}
          {signedAt && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-center justify-between text-xs text-emerald-900">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
                <div>
                  <span className="font-bold">Executed Agreement</span>
                  <div className="text-[11px] text-emerald-700 mt-0.5">
                    Executed on {new Date(signedAt).toLocaleString()}
                    {signatureReference && ` · Audit Ref: ${signatureReference}`}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ── Public Footer ───────────────────────────────────────────── */}
      <footer className="bg-white border-t border-slate-200 px-6 py-4 text-center text-xs text-slate-500">
        <p>
          Link expires {new Date(expiresAt).toLocaleDateString()} &bull; Read-only token-gated
          snapshot provided by {brandName}.
        </p>
      </footer>
    </div>
  );
}
