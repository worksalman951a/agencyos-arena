'use client';

import * as React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { type DocumentInfo } from './use-builder-state';

const NONE_SENTINEL = '__none__';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  rejected: 'Rejected',
  expired: 'Expired',
};

function allowedStatusOptions(isEdit: boolean, savedStatus: string): string[] {
  if (!isEdit) {
    return ['draft', 'sent'];
  }
  if (savedStatus === 'draft') {
    return ['draft', 'sent', 'expired'];
  }
  if (savedStatus === 'sent') {
    return ['sent', 'accepted', 'rejected', 'expired'];
  }
  return [savedStatus];
}

interface DocumentInfoProps {
  info: DocumentInfo;
  currencies: string[];
  contacts: Array<{ id: string; firstName?: string | null; lastName?: string | null }>;
  opportunities: Array<{ id: string; title: string }>;
  loading: boolean;
  isEdit?: boolean;
  savedStatus?: string;
  onChange: (updates: Partial<DocumentInfo>) => void;
}

export function DocumentInfoForm({
  info,
  currencies,
  contacts,
  opportunities,
  loading,
  isEdit = false,
  savedStatus = 'draft',
  onChange,
}: DocumentInfoProps) {
  const statusOptions = React.useMemo(() => {
    const opts = allowedStatusOptions(isEdit, savedStatus);
    return opts.includes(info.status) ? opts : [...opts, info.status];
  }, [isEdit, savedStatus, info.status]);

  const currencyOptions = React.useMemo(
    () => (currencies.includes(info.currency) ? currencies : [info.currency, ...currencies]),
    [currencies, info.currency]
  );

  return (
    <section className="space-y-6">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Document Information
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="title">
            Title <span className="text-destructive">*</span>
          </Label>
          <Input
            id="title"
            value={info.title}
            onChange={(e) => onChange({ title: e.target.value })}
            disabled={loading}
            placeholder="e.g. Website Redesign Proposal"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="currency">Currency</Label>
          <Select
            value={info.currency}
            onValueChange={(value) => onChange({ currency: value })}
            disabled={loading}
          >
            <SelectTrigger id="currency">
              <SelectValue placeholder="Select currency" />
            </SelectTrigger>
            <SelectContent>
              {currencyOptions.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <Select
            value={info.status}
            onValueChange={(value) => onChange({ status: value })}
            disabled={loading || statusOptions.length <= 1}
          >
            <SelectTrigger id="status">
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((st) => (
                <SelectItem key={st} value={st}>
                  {STATUS_LABELS[st] ?? st}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="contactId">Contact / Client</Label>
          <Select
            value={info.contactId ?? NONE_SENTINEL}
            onValueChange={(value) =>
              onChange({ contactId: value === NONE_SENTINEL ? null : value })
            }
            disabled={loading || contacts.length === 0}
          >
            <SelectTrigger id="contactId">
              <SelectValue placeholder="Select a contact..." />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Contacts</SelectLabel>
                <SelectItem value={NONE_SENTINEL}>None</SelectItem>
                {contacts.map((contact) => {
                  const name =
                    [contact.firstName ?? '', contact.lastName ?? ''].join(' ').trim() ||
                    'Unnamed Contact';
                  return (
                    <SelectItem key={contact.id} value={contact.id}>
                      {name}
                    </SelectItem>
                  );
                })}
              </SelectGroup>
            </SelectContent>
          </Select>
          {contacts.length === 0 && (
            <p className="text-xs text-muted-foreground">No contacts found in your organization.</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="opportunityId">Opportunity</Label>
          <Select
            value={info.opportunityId ?? NONE_SENTINEL}
            onValueChange={(value) =>
              onChange({ opportunityId: value === NONE_SENTINEL ? null : value })
            }
            disabled={loading || opportunities.length === 0}
          >
            <SelectTrigger id="opportunityId">
              <SelectValue placeholder="Select an opportunity..." />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Opportunities</SelectLabel>
                <SelectItem value={NONE_SENTINEL}>None</SelectItem>
                {opportunities.map((opp) => (
                  <SelectItem key={opp.id} value={opp.id}>
                    {opp.title}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {opportunities.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No opportunities found in your organization.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="validUntil">Valid Until</Label>
          <Input
            id="validUntil"
            type="date"
            value={info.validUntil ?? ''}
            onChange={(e) => onChange({ validUntil: e.target.value || null })}
            disabled={loading}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>
      </div>

      <Separator />

      <div className="space-y-2">
        <Label htmlFor="notes">Notes / Terms</Label>
        <Textarea
          id="notes"
          value={info.notes ?? ''}
          onChange={(e) => onChange({ notes: e.target.value || null })}
          disabled={loading}
          rows={4}
          placeholder="Terms and conditions, special notes..."
          className="flex h-32 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      </div>
    </section>
  );
}
