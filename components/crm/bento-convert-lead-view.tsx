'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  TrendingUp,
  DollarSign,
  Calendar,
  User,
  Shield,
  AlertTriangle,
} from 'lucide-react';
import { Panel, StatStrip, KeyValueRow } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import '@/components/crm/bento-contacts.css';

export interface ConvertLeadFormData {
  title: string;
  description: string;
  value: string;
  currency: string;
  pipelineId: string;
  stageId: string;
  ownerId: string;
  closeDate: string;
}

interface BentoConvertLeadViewProps {
  leadId: string;
  lead: {
    id: string;
    source: string;
    status: string;
    expectedValue: string | null;
    contactId: string | null;
    accountId: string | null;
    ownerId: string | null;
    pipelineId: string | null;
    stageId: string | null;
    convertedOpportunity: {
      id: string;
      title: string;
      status: string;
      value: string | null;
      currency: string;
    } | null;
  };
  formData: ConvertLeadFormData;
  setFormData: React.Dispatch<React.SetStateAction<ConvertLeadFormData>>;
  onSubmit: () => void;
  isLoading: boolean;
  error: string | null;
  success: {
    opportunityId: string;
    opportunityTitle: string;
  } | null;
}

export function BentoConvertLeadView({
  leadId,
  lead,
  formData,
  setFormData,
  onSubmit,
  isLoading,
  error,
  success,
}: BentoConvertLeadViewProps) {
  const updateField = (field: keyof ConvertLeadFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // Already Converted State
  if (lead.convertedOpportunity) {
    return (
      <div className="bento-crm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="icon" className="h-8 w-8" title="Back to lead">
              <Link href={`/crm/leads/${leadId}`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Link href="/crm/leads" className="hover:underline">
                  CRM
                </Link>
                <span>/</span>
                <Link href={`/crm/leads/${leadId}`} className="hover:underline">
                  Lead #{leadId.slice(-6)}
                </Link>
                <span>/</span>
                <span>Convert</span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
                Lead Already Converted
              </h1>
            </div>
          </div>
          <Button asChild variant="outline" size="sm" className="h-8 text-xs">
            <Link href={`/crm/leads/${leadId}`}>Back to Lead</Link>
          </Button>
        </div>

        <StatStrip
          stats={[
            {
              label: 'Lead Status',
              value: 'CONVERTED',
              note: `Originating lead #${leadId.slice(-6)}`,
              tone: 'ok',
            },
            {
              label: 'Generated Deal',
              value: lead.convertedOpportunity.title,
              note: 'active sales opportunity',
            },
            {
              label: 'Opportunity Stage',
              value: lead.convertedOpportunity.status.toUpperCase(),
              note: 'in sales pipeline',
              tone: 'ok',
            },
            {
              label: 'Valuation',
              value: lead.convertedOpportunity.value
                ? `${lead.convertedOpportunity.currency} ${Number(lead.convertedOpportunity.value).toLocaleString()}`
                : 'Undisclosed',
              note: 'deal valuation',
            },
          ]}
        />

        <Panel title="Converted Opportunity Details">
          <div className="p-4 space-y-4 max-w-xl text-xs">
            <div className="p-3 bg-accent/10 border border-accent/20 rounded-md flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-accent shrink-0" />
              <div>
                <div className="font-semibold text-foreground">Conversion Completed</div>
                <div className="text-muted-foreground text-[11px]">
                  This lead was converted into sales opportunity{' '}
                  <strong>{lead.convertedOpportunity.title}</strong>.
                </div>
              </div>
            </div>

            <div className="space-y-2 border-t border-border pt-3">
              <KeyValueRow
                label="Opportunity Title"
                value={
                  <Link
                    href={`/crm/opportunities/${lead.convertedOpportunity.id}`}
                    className="text-accent font-semibold hover:underline"
                  >
                    {lead.convertedOpportunity.title}
                  </Link>
                }
              />
              <KeyValueRow label="Status" value={lead.convertedOpportunity.status} />
              <KeyValueRow
                label="Valuation"
                value={
                  lead.convertedOpportunity.value
                    ? `${lead.convertedOpportunity.currency} ${Number(lead.convertedOpportunity.value).toLocaleString()}`
                    : '—'
                }
              />
            </div>

            <div className="pt-2 flex gap-2">
              <Button asChild className="bg-accent text-accent-foreground" size="sm">
                <Link href={`/crm/opportunities/${lead.convertedOpportunity.id}`}>
                  Open Opportunity
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href={`/crm/leads/${leadId}`}>Return to Lead</Link>
              </Button>
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-8 w-8" title="Cancel and return">
            <Link href={`/crm/leads/${leadId}`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Link href="/crm/leads" className="hover:underline">
                CRM
              </Link>
              <span>/</span>
              <Link href={`/crm/leads/${leadId}`} className="hover:underline">
                Lead #{leadId.slice(-6)}
              </Link>
              <span>/</span>
              <span>Convert</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              Convert Lead to Opportunity
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="h-8 text-xs">
            <Link href={`/crm/leads/${leadId}`}>Cancel</Link>
          </Button>
          {!success && (
            <Button
              type="button"
              size="sm"
              disabled={isLoading}
              onClick={onSubmit}
              className="h-8 text-xs bg-accent text-accent-foreground hover:bg-accent/90"
            >
              <TrendingUp className="h-3.5 w-3.5 mr-1.5" />
              {isLoading ? 'Converting Lead…' : 'Convert to Opportunity'}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3 text-xs bg-destructive/10 text-destructive rounded-md border border-destructive/20 flex items-center gap-2"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="p-3 text-xs bg-emerald-500/10 text-emerald-600 rounded-md border border-emerald-500/20 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>
              Lead converted successfully to opportunity <strong>{success.opportunityTitle}</strong>
              .
            </span>
          </div>
          <Button asChild size="sm" variant="outline" className="h-7 text-xs">
            <Link href={`/crm/opportunities/${success.opportunityId}`}>View Opportunity</Link>
          </Button>
        </div>
      )}

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Originating Lead',
            value: `#${leadId.slice(-6)}`,
            note: `Source: ${lead.source}`,
          },
          {
            label: 'Projected Valuation',
            value: formData.value
              ? `${formData.currency} ${Number(formData.value).toLocaleString()}`
              : '$0.00',
            note: lead.expectedValue ? 'Pre-filled from lead expectation' : 'Target deal valuation',
            tone: formData.value ? 'ok' : undefined,
          },
          {
            label: 'Lead Status',
            value: lead.status.toUpperCase(),
            note: 'Transitioning to Opportunity',
            tone: 'warn',
          },
          {
            label: 'Atomic Conversion',
            value: 'Idempotent',
            note: 'Duplicate conversion protected',
            tone: 'ok',
          },
        ]}
      />

      {/* ── Form Body & Relational Sidebar ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-6">
          <Panel title="New Opportunity Specifications">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onSubmit();
              }}
              className="space-y-4 text-xs"
            >
              <div className="space-y-1.5">
                <label
                  htmlFor="conv-title"
                  className="font-semibold text-foreground flex items-center gap-1.5"
                >
                  <TrendingUp className="h-3.5 w-3.5 text-accent" />
                  Opportunity Title <span className="text-destructive">*</span>
                </label>
                <Input
                  id="conv-title"
                  value={formData.title}
                  onChange={(e) => updateField('title', e.target.value)}
                  placeholder="e.g. Acme Corp Contract"
                  className="h-8 text-xs"
                  required
                />
              </div>

              <div className="space-y-1.5 pt-2 border-t border-border">
                <label htmlFor="conv-desc" className="font-semibold text-foreground">
                  Description
                </label>
                <textarea
                  id="conv-desc"
                  value={formData.description}
                  onChange={(e) => updateField('description', e.target.value)}
                  rows={3}
                  placeholder="Notes from initial lead qualification..."
                  className="w-full border border-input rounded-md px-3 py-2 text-xs bg-background text-foreground"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-border">
                <div className="space-y-1.5">
                  <label
                    htmlFor="conv-val"
                    className="font-semibold text-foreground flex items-center gap-1.5"
                  >
                    <DollarSign className="h-3.5 w-3.5 text-accent" />
                    Deal Value
                  </label>
                  <Input
                    id="conv-val"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.value}
                    onChange={(e) => updateField('value', e.target.value)}
                    placeholder="0.00"
                    className="h-8 text-xs font-mono"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Pre-filled from lead expected value (
                    {lead.expectedValue
                      ? `$${Number(lead.expectedValue).toLocaleString()}`
                      : 'None'}
                    ).
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="conv-currency" className="font-semibold text-foreground">
                    Currency
                  </label>
                  <select
                    id="conv-currency"
                    value={formData.currency}
                    onChange={(e) => updateField('currency', e.target.value)}
                    className="w-full h-8 border border-input rounded-md px-2 text-xs bg-background text-foreground"
                  >
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="GBP">GBP (£)</option>
                    <option value="PKR">PKR (₨)</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-border">
                <label
                  htmlFor="conv-close"
                  className="font-semibold text-foreground flex items-center gap-1.5"
                >
                  <Calendar className="h-3.5 w-3.5 text-accent" />
                  Target Close Date
                </label>
                <Input
                  id="conv-close"
                  type="date"
                  value={formData.closeDate}
                  onChange={(e) => updateField('closeDate', e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              {!success && (
                <div className="pt-3 border-t border-border flex justify-end gap-2">
                  <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                    <Link href={`/crm/leads/${leadId}`}>Cancel</Link>
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={isLoading}
                    className="h-8 text-xs bg-accent text-accent-foreground hover:bg-accent/90"
                  >
                    <TrendingUp className="h-3.5 w-3.5 mr-1.5" />
                    {isLoading ? 'Converting...' : 'Convert to Opportunity'}
                  </Button>
                </div>
              )}
            </form>
          </Panel>
        </div>

        {/* Association Sidebar */}
        <div className="space-y-6">
          <Panel title="Pipeline & Relational Scope">
            <div className="p-1 space-y-3 text-xs">
              <div className="space-y-1.5">
                <label
                  htmlFor="conv-pipe"
                  className="font-semibold text-foreground flex items-center gap-1.5"
                >
                  <Shield className="h-3.5 w-3.5 text-accent" />
                  Pipeline ID
                </label>
                <Input
                  id="conv-pipe"
                  value={formData.pipelineId}
                  onChange={(e) => updateField('pipelineId', e.target.value)}
                  placeholder="e.g. cmxxxxxxx"
                  className="h-8 text-xs font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="conv-stage" className="font-semibold text-foreground">
                  Stage ID
                </label>
                <Input
                  id="conv-stage"
                  value={formData.stageId}
                  onChange={(e) => updateField('stageId', e.target.value)}
                  placeholder="e.g. cmxxxxxxx"
                  className="h-8 text-xs font-mono"
                />
              </div>

              <div className="space-y-1.5 pt-2 border-t border-border">
                <label
                  htmlFor="conv-owner"
                  className="font-semibold text-foreground flex items-center gap-1.5"
                >
                  <User className="h-3.5 w-3.5 text-accent" />
                  Owner / Assignee ID
                </label>
                <Input
                  id="conv-owner"
                  value={formData.ownerId}
                  onChange={(e) => updateField('ownerId', e.target.value)}
                  placeholder="e.g. cmxxxxxxx"
                  className="h-8 text-xs font-mono"
                />
              </div>

              <div className="border-t border-border pt-3 space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Security Guardrails
                </div>
                <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-accent shrink-0 mt-0.5" />
                  <span>Enforces server-side 409 conflict if lead is already converted.</span>
                </div>
                <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-accent shrink-0 mt-0.5" />
                  <span>Conversion is wrapped in an atomic database transaction.</span>
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
