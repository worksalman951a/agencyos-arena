'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Save,
  TrendingUp,
  DollarSign,
  Calendar,
  User,
  Shield,
  AlertTriangle,
} from 'lucide-react';
import { Panel, StatStrip } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import '@/components/crm/bento-contacts.css';

export interface OpportunityFormData {
  title: string;
  description: string;
  value: string;
  currency: string;
  closeDate: string;
  ownerId: string;
  status: string;
  probability: string;
  lossReason: string;
  contactId: string;
  accountId: string;
  leadId: string;
  pipelineId: string;
  stageId: string;
}

interface BentoOpportunityFormViewProps {
  mode: 'new' | 'edit';
  opportunityId?: string;
  formData: OpportunityFormData;
  setFormData: React.Dispatch<React.SetStateAction<OpportunityFormData>>;
  onSubmit: () => void;
  isLoading: boolean;
  error: string | null;
  onArchive?: () => void;
}

export function BentoOpportunityFormView({
  mode,
  opportunityId,
  formData,
  setFormData,
  onSubmit,
  isLoading,
  error,
  onArchive,
}: BentoOpportunityFormViewProps) {
  const isEdit = mode === 'edit';

  const updateField = (field: keyof OpportunityFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const getStatusTone = (status: string): 'ok' | 'warn' | 'danger' | undefined => {
    switch (status.toLowerCase()) {
      case 'won':
        return 'ok';
      case 'lost':
        return 'danger';
      case 'archived':
        return undefined;
      default:
        return 'warn';
    }
  };

  return (
    <div className="bento-crm space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-8 w-8" title="Cancel and return">
            <Link
              href={
                isEdit && opportunityId
                  ? `/crm/opportunities/${opportunityId}`
                  : '/crm/opportunities'
              }
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Link href="/crm/opportunities" className="hover:underline">
                CRM
              </Link>
              <span>/</span>
              <Link href="/crm/opportunities" className="hover:underline">
                Opportunities
              </Link>
              <span>/</span>
              <span>{isEdit ? 'Edit Opportunity' : 'New Opportunity'}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              {isEdit
                ? `Edit Opportunity: ${formData.title || 'Untitled'}`
                : 'New Sales Opportunity'}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="h-8 text-xs">
            <Link
              href={
                isEdit && opportunityId
                  ? `/crm/opportunities/${opportunityId}`
                  : '/crm/opportunities'
              }
            >
              Cancel
            </Link>
          </Button>
          {isEdit && onArchive && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onArchive}
              disabled={isLoading}
              className="h-8 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
            >
              Archive
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            disabled={isLoading}
            onClick={onSubmit}
            className="h-8 text-xs bg-accent text-accent-foreground hover:bg-accent/90"
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {isLoading ? 'Saving Changes…' : isEdit ? 'Save Opportunity' : 'Create Opportunity'}
          </Button>
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

      {/* ── StatStrip Summary Metrics ─────────────────────────────────── */}
      <StatStrip
        stats={[
          {
            label: 'Deal Valuation',
            value: formData.value
              ? `${formData.currency} ${Number(formData.value).toLocaleString()}`
              : '$0.00',
            note: 'projected deal size',
            tone: formData.value ? 'ok' : undefined,
          },
          {
            label: 'Win Probability',
            value: formData.probability ? `${formData.probability}%` : 'Not Set',
            note: 'confidence estimate',
          },
          {
            label: 'Deal Lifecycle',
            value: formData.status.toUpperCase(),
            note: 'sales pipeline state',
            tone: getStatusTone(formData.status),
          },
          {
            label: 'Expected Close',
            value: formData.closeDate || 'Undated',
            note: 'forecast timeline',
          },
        ]}
      />

      {/* ── Form Body & Inspection Sidebar ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Main Parameters */}
        <div className="lg:col-span-2 space-y-6">
          <Panel title="Opportunity Specifications">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onSubmit();
              }}
              className="space-y-4 text-xs"
            >
              <div className="space-y-1.5">
                <label
                  htmlFor="opp-title"
                  className="font-semibold text-foreground flex items-center gap-1.5"
                >
                  <TrendingUp className="h-3.5 w-3.5 text-accent" />
                  Opportunity Title <span className="text-destructive">*</span>
                </label>
                <Input
                  id="opp-title"
                  value={formData.title}
                  onChange={(e) => updateField('title', e.target.value)}
                  placeholder="e.g. Enterprise Cloud Migration Q4"
                  className="h-8 text-xs"
                  required
                />
              </div>

              <div className="space-y-1.5 pt-2 border-t border-border">
                <label htmlFor="opp-desc" className="font-semibold text-foreground">
                  Deal Description & Objectives
                </label>
                <textarea
                  id="opp-desc"
                  value={formData.description}
                  onChange={(e) => updateField('description', e.target.value)}
                  rows={3}
                  placeholder="Outline client goals, key pain points, and strategic scope..."
                  className="w-full border border-input rounded-md px-3 py-2 text-xs bg-background text-foreground"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-border">
                <div className="space-y-1.5">
                  <label
                    htmlFor="opp-value"
                    className="font-semibold text-foreground flex items-center gap-1.5"
                  >
                    <DollarSign className="h-3.5 w-3.5 text-accent" />
                    Valuation Amount
                  </label>
                  <Input
                    id="opp-value"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.value}
                    onChange={(e) => updateField('value', e.target.value)}
                    placeholder="0.00"
                    className="h-8 text-xs font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="opp-currency" className="font-semibold text-foreground">
                    Currency
                  </label>
                  <select
                    id="opp-currency"
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

                <div className="space-y-1.5">
                  <label htmlFor="opp-prob" className="font-semibold text-foreground">
                    Probability (%)
                  </label>
                  <Input
                    id="opp-prob"
                    type="number"
                    min="0"
                    max="100"
                    value={formData.probability}
                    onChange={(e) => updateField('probability', e.target.value)}
                    placeholder="0-100"
                    className="h-8 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-border">
                <div className="space-y-1.5">
                  <label htmlFor="opp-status" className="font-semibold text-foreground">
                    Lifecycle Status <span className="text-destructive">*</span>
                  </label>
                  <select
                    id="opp-status"
                    value={formData.status}
                    onChange={(e) => updateField('status', e.target.value)}
                    className="w-full h-8 border border-input rounded-md px-2 text-xs bg-background text-foreground"
                  >
                    <option value="open">Open (Active Negotiation)</option>
                    <option value="won">Won (Contract Executed)</option>
                    <option value="lost">Lost (Closed Unsuccessful)</option>
                    <option value="archived">Archived (Dormant)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="opp-closedate"
                    className="font-semibold text-foreground flex items-center gap-1.5"
                  >
                    <Calendar className="h-3.5 w-3.5 text-accent" />
                    Target Close Date
                  </label>
                  <Input
                    id="opp-closedate"
                    type="date"
                    value={formData.closeDate}
                    onChange={(e) => updateField('closeDate', e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              {formData.status === 'lost' && (
                <div className="space-y-1.5 pt-2 border-t border-border">
                  <label htmlFor="opp-loss" className="font-semibold text-destructive">
                    Loss Reason
                  </label>
                  <textarea
                    id="opp-loss"
                    value={formData.lossReason}
                    onChange={(e) => updateField('lossReason', e.target.value)}
                    rows={2}
                    placeholder="Detail competitor selection, budget cancellation, or scope shift..."
                    className="w-full border border-destructive/40 rounded-md px-3 py-2 text-xs bg-destructive/5 text-foreground"
                  />
                </div>
              )}

              <div className="pt-3 border-t border-border flex justify-end gap-2">
                <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                  <Link
                    href={
                      isEdit && opportunityId
                        ? `/crm/opportunities/${opportunityId}`
                        : '/crm/opportunities'
                    }
                  >
                    Cancel
                  </Link>
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isLoading}
                  className="h-8 text-xs bg-accent text-accent-foreground hover:bg-accent/90"
                >
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                  {isLoading ? 'Saving...' : isEdit ? 'Save Opportunity' : 'Create Opportunity'}
                </Button>
              </div>
            </form>
          </Panel>
        </div>

        {/* Association & Pipeline Mapping */}
        <div className="space-y-6">
          <Panel title="Pipeline & Relational Scope">
            <div className="p-1 space-y-3 text-xs">
              <div className="space-y-1.5">
                <label
                  htmlFor="opp-pipeline"
                  className="font-semibold text-foreground flex items-center gap-1.5"
                >
                  <Shield className="h-3.5 w-3.5 text-accent" />
                  Pipeline ID
                </label>
                <Input
                  id="opp-pipeline"
                  value={formData.pipelineId}
                  onChange={(e) => updateField('pipelineId', e.target.value)}
                  placeholder="e.g. cmxxxxxxx"
                  className="h-8 text-xs font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="opp-stage" className="font-semibold text-foreground">
                  Stage ID
                </label>
                <Input
                  id="opp-stage"
                  value={formData.stageId}
                  onChange={(e) => updateField('stageId', e.target.value)}
                  placeholder="e.g. cmxxxxxxx"
                  className="h-8 text-xs font-mono"
                />
              </div>

              <div className="space-y-1.5 pt-2 border-t border-border">
                <label
                  htmlFor="opp-owner"
                  className="font-semibold text-foreground flex items-center gap-1.5"
                >
                  <User className="h-3.5 w-3.5 text-accent" />
                  Account Exec / Owner ID
                </label>
                <Input
                  id="opp-owner"
                  value={formData.ownerId}
                  onChange={(e) => updateField('ownerId', e.target.value)}
                  placeholder="e.g. cmxxxxxxx"
                  className="h-8 text-xs font-mono"
                />
              </div>

              <div className="border-t border-border pt-2 space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Client & Entity Links
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="opp-contact" className="text-muted-foreground">
                    Contact ID:
                  </label>
                  <Input
                    id="opp-contact"
                    value={formData.contactId}
                    onChange={(e) => updateField('contactId', e.target.value)}
                    placeholder="e.g. cmxxxxxxx"
                    className="h-7 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="opp-account" className="text-muted-foreground">
                    Account ID:
                  </label>
                  <Input
                    id="opp-account"
                    value={formData.accountId}
                    onChange={(e) => updateField('accountId', e.target.value)}
                    placeholder="e.g. cmxxxxxxx"
                    className="h-7 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="opp-lead" className="text-muted-foreground">
                    Originating Lead ID:
                  </label>
                  <Input
                    id="opp-lead"
                    value={formData.leadId}
                    onChange={(e) => updateField('leadId', e.target.value)}
                    placeholder="e.g. cmxxxxxxx"
                    className="h-7 text-xs font-mono"
                  />
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
