'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Download, CheckCircle2, XCircle, AlertTriangle, Lock } from 'lucide-react';
import { Panel, StatusPill } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';

interface DocumentItem {
  id: string;
  type: 'proposal' | 'quotation' | 'contract';
  number: string;
  title: string;
  total: string;
  currency: string;
  status: string;
  validUntil: Date | null;
  createdAt: Date;
  version?: string;
}

interface ClientPortalDocumentsClientProps {
  documents: DocumentItem[];
}

export function ClientPortalDocumentsClient({ documents }: ClientPortalDocumentsClientProps) {
  const router = useRouter();
  const [selectedDoc, setSelectedDoc] = React.useState<DocumentItem | null>(null);
  const [actionType, setActionType] = React.useState<'accept' | 'reject' | null>(null);
  const [reason, setReason] = React.useState('');
  const [signerName, setSignerName] = React.useState('');
  const [consentGiven, setConsentGiven] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ text: string; error?: boolean } | null>(null);

  const openActionModal = (doc: DocumentItem, action: 'accept' | 'reject') => {
    setSelectedDoc(doc);
    setActionType(action);
    setReason('');
    setConsentGiven(false);
    setFeedback(null);
  };

  const closeActionModal = () => {
    setSelectedDoc(null);
    setActionType(null);
    setIsSubmitting(false);
    setFeedback(null);
  };

  const handleActionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDoc || !actionType) return;

    if (selectedDoc.type === 'contract' && actionType === 'accept' && !consentGiven) {
      setFeedback({
        text: 'You must provide consent to electronically sign this contract.',
        error: true,
      });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/v1/portal/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: selectedDoc.id,
          documentType: selectedDoc.type,
          action: actionType,
          expectedVersion: selectedDoc.version || new Date(selectedDoc.createdAt).toISOString(),
          reason: reason.trim() || undefined,
          signerName: signerName.trim() || undefined,
          consentGiven: selectedDoc.type === 'contract' ? consentGiven : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Action failed');
      }

      setFeedback({
        text: `Document successfully ${actionType === 'accept' ? 'accepted' : 'rejected'}.`,
      });
      setTimeout(() => {
        closeActionModal();
        router.refresh();
      }, 1200);
    } catch (err) {
      setFeedback({ text: (err as Error).message, error: true });
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Panel title="Commercial Deliverables & Agreements">
        {documents.length === 0 ? (
          <div className="text-center py-12 text-xs text-muted-foreground">
            No proposals, quotations, or contracts assigned to your account.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  <th className="py-2.5 px-4">Type</th>
                  <th className="py-2.5 px-4">Number</th>
                  <th className="py-2.5 px-4">Title</th>
                  <th className="py-2.5 px-4">Valid Until / Signed</th>
                  <th className="py-2.5 px-4 text-right">Value</th>
                  <th className="py-2.5 px-4 text-center">Status</th>
                  <th className="py-2.5 px-4 text-right">PDF</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {documents.map((doc) => {
                  const isActionable =
                    (doc.type === 'proposal' && doc.status === 'sent') ||
                    (doc.type === 'quotation' && doc.status === 'sent') ||
                    (doc.type === 'contract' && doc.status !== 'signed' && doc.status !== 'voided');

                  return (
                    <tr
                      key={`${doc.type}-${doc.id}`}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      <td className="py-3 px-4 font-medium uppercase text-[10px]">
                        <span className="bg-muted px-2 py-0.5 rounded text-muted-foreground">
                          {doc.type}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono font-semibold text-foreground">
                        {doc.number}
                      </td>
                      <td className="py-3 px-4 text-foreground font-medium">{doc.title}</td>
                      <td className="py-3 px-4 text-muted-foreground">
                        {doc.validUntil ? new Date(doc.validUntil).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-foreground">
                        {doc.currency ? `${doc.currency} ${doc.total}` : doc.total}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <StatusPill
                          tone={
                            doc.status === 'accepted' || doc.status === 'signed'
                              ? 'ok'
                              : doc.status === 'rejected' || doc.status === 'voided'
                                ? 'danger'
                                : 'warn'
                          }
                        >
                          {doc.status.toUpperCase()}
                        </StatusPill>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                          <a
                            href={`/api/v1/portal/pdf?type=${doc.type}&id=${doc.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Download size={12} className="mr-1" /> PDF
                          </a>
                        </Button>
                      </td>
                      <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                        {isActionable ? (
                          <>
                            <Button
                              size="sm"
                              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                              onClick={() => openActionModal(doc, 'accept')}
                            >
                              <CheckCircle2 size={12} className="mr-1" />
                              {doc.type === 'contract' ? 'Sign Agreement' : 'Accept'}
                            </Button>
                            {doc.type !== 'contract' && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs text-destructive hover:bg-destructive/10"
                                onClick={() => openActionModal(doc, 'reject')}
                              >
                                <XCircle size={12} className="mr-1" />
                                Reject
                              </Button>
                            )}
                          </>
                        ) : (
                          <span className="text-[11px] text-muted-foreground italic flex items-center justify-end gap-1">
                            <Lock size={11} /> Locked
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ── Document Action Modal ───────────────────────────────────── */}
      {selectedDoc && actionType && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-background border border-border rounded-xl shadow-lg max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-2">
              {actionType === 'accept' ? (
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600">
                  <CheckCircle2 size={20} />
                </div>
              ) : (
                <div className="p-2 rounded-lg bg-destructive/10 text-destructive">
                  <AlertTriangle size={20} />
                </div>
              )}
              <div>
                <h3 className="text-sm font-bold text-foreground">
                  {actionType === 'accept'
                    ? selectedDoc.type === 'contract'
                      ? 'Electronically Accept Contract'
                      : `Accept ${selectedDoc.type.toUpperCase()} ${selectedDoc.number}`
                    : `Reject ${selectedDoc.type.toUpperCase()} ${selectedDoc.number}`}
                </h3>
                <p className="text-xs text-muted-foreground">{selectedDoc.title}</p>
              </div>
            </div>

            {feedback && (
              <div
                className={`p-3 rounded-md text-xs ${
                  feedback.error
                    ? 'bg-destructive/10 text-destructive border border-destructive/20'
                    : 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 border border-emerald-500/20'
                }`}
              >
                {feedback.text}
              </div>
            )}

            <form onSubmit={handleActionSubmit} className="space-y-4">
              {selectedDoc.type === 'contract' && actionType === 'accept' && (
                <div className="space-y-3 bg-muted/30 p-3 rounded-lg border border-border">
                  <div className="text-[11px] text-muted-foreground leading-relaxed">
                    By checking consent, you record your electronic signature under server-audited
                    execution logs. This action transitions the contract status to{' '}
                    <strong>SIGNED</strong>.
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-foreground">
                      Signer Full Name
                    </label>
                    <input
                      type="text"
                      placeholder="Your Full Name"
                      value={signerName}
                      onChange={(e) => setSignerName(e.target.value)}
                      className="w-full bg-background border border-input rounded px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <label className="flex items-start gap-2 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={consentGiven}
                      onChange={(e) => setConsentGiven(e.target.checked)}
                      className="mt-0.5 rounded border-input text-accent focus:ring-accent"
                    />
                    <span className="text-[11px] font-medium text-foreground">
                      I agree and confirm that this electronic acceptance constitutes my legally
                      binding signature.
                    </span>
                  </label>
                </div>
              )}

              {actionType === 'reject' && (
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-foreground">
                    Reason for Rejection (Optional)
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Provide details or revisions requested…"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="w-full bg-background border border-input rounded p-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={closeActionModal}
                  disabled={isSubmitting}
                  className="h-8 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSubmitting}
                  className={`h-8 text-xs ${
                    actionType === 'accept'
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      : 'bg-destructive hover:bg-destructive/90 text-destructive-foreground'
                  }`}
                >
                  {isSubmitting
                    ? 'Submitting…'
                    : actionType === 'accept'
                      ? selectedDoc.type === 'contract'
                        ? 'Confirm & Sign'
                        : 'Confirm Acceptance'
                      : 'Confirm Rejection'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
