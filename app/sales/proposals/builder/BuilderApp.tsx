'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Separator } from '@/components/ui/separator';
import { DocumentInfoForm } from '@/components/builder/document-info';
import { LineItemEditor, type LineItem } from '@/components/builder/line-item-editor';
import { ClientSelector } from '@/components/builder/client-selector';
import { DocumentPreview } from '@/components/builder/document-preview';
import { BuilderLayout } from '@/components/builder/builder-layout';
import { useBuilderState, type DocumentInfo } from '@/components/builder/use-builder-state';
import { useUnsavedChanges } from '@/components/builder/use-unsaved-changes';
import { useToast } from '@/components/ui/toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/** Zod schema for the builder form */
const builderSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  contactId: z.string().cuid().optional().nullable(),
  opportunityId: z.string().cuid().optional().nullable(),
  currency: z.string().min(1).max(10).default('USD'),
  validUntil: z.string().optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  status: z.string().min(1).max(50).default('draft'),
});

type BuilderFormValues = z.infer<typeof builderSchema>;

interface ProposalData {
  id: string;
  title: string;
  status: string;
  currency: string;
  validUntil: string | null;
  notes: string | null;
  contactId: string | null;
  opportunityId: string | null;
  number: string | null;
  createdAt: string | null;
  items: Array<{
    id: string;
    description: string;
    quantity: number | string;
    unitPrice: number | string;
    taxRate: number | string;
    sortOrder: number;
  }>;
}

interface ContactOption {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

interface OpportunityOption {
  id: string;
  title: string;
}

interface ProposalBuilderAppProps {
  isEdit: boolean;
  proposalId: string | null;
  existingProposal: ProposalData | null;
  initialContacts: ContactOption[];
  initialOpportunities: OpportunityOption[];
  /** Organization default currency for new documents (settings). */
  defaultCurrency?: string;
}

const API_BASE = '/api/v1/crm/proposals';

export function ProposalBuilderApp({
  isEdit,
  proposalId,
  existingProposal,
  initialContacts,
  initialOpportunities,
  defaultCurrency = 'USD',
}: ProposalBuilderAppProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [showDiscardDialog, setShowDiscardDialog] = React.useState(false);
  const [contacts] = React.useState<ContactOption[]>(initialContacts);
  const [opportunities] = React.useState<OpportunityOption[]>(initialOpportunities);

  const initialInfo: DocumentInfo = React.useMemo(() => {
    if (existingProposal) {
      return {
        title: existingProposal.title,
        contactId: existingProposal.contactId,
        opportunityId: existingProposal.opportunityId,
        currency: existingProposal.currency,
        validUntil: existingProposal.validUntil,
        notes: existingProposal.notes,
        status: existingProposal.status,
      };
    }
    return {
      title: '',
      contactId: null,
      opportunityId: null,
      currency: defaultCurrency,
      validUntil: null,
      notes: null,
      status: 'draft',
    };
  }, [existingProposal, defaultCurrency]);

  const initialItems: LineItem[] = React.useMemo(() => {
    if (existingProposal?.items) {
      return existingProposal.items.map((item) => ({
        id: String((item as Record<string, unknown>).id ?? crypto.randomUUID()),
        description: String((item as Record<string, unknown>).description),
        quantity: String((item as Record<string, unknown>).quantity ?? '1'),
        unitPrice: String((item as Record<string, unknown>).unitPrice ?? '0'),
        taxRate: String((item as Record<string, unknown>).taxRate ?? '0'),
        sortOrder: Number((item as Record<string, unknown>).sortOrder ?? 0),
      }));
    }
    return [
      {
        id: crypto.randomUUID(),
        description: '',
        quantity: '1',
        unitPrice: '0',
        taxRate: '0',
        sortOrder: 0,
      },
    ];
  }, [existingProposal]);

  const builder = useBuilderState(initialInfo, initialItems);

  const form = useForm<BuilderFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(builderSchema) as any,
    defaultValues: {
      title: builder.documentInfo.title,
      contactId: builder.documentInfo.contactId,
      opportunityId: builder.documentInfo.opportunityId,
      currency: builder.documentInfo.currency,
      validUntil: builder.documentInfo.validUntil,
      notes: builder.documentInfo.notes,
      status: builder.documentInfo.status,
    },
  });

  React.useEffect(() => {
    form.setValue('title', builder.documentInfo.title, { shouldDirty: true });
    form.setValue('contactId', builder.documentInfo.contactId, { shouldDirty: true });
    form.setValue('opportunityId', builder.documentInfo.opportunityId, { shouldDirty: true });
    form.setValue('currency', builder.documentInfo.currency, {
      shouldDirty: true,
    });
    form.setValue('validUntil', builder.documentInfo.validUntil, { shouldDirty: true });
    form.setValue('notes', builder.documentInfo.notes, { shouldDirty: true });
    form.setValue('status', builder.documentInfo.status, {
      shouldDirty: true,
    });
  }, [builder.documentInfo, form]);

  useUnsavedChanges(builder.isDirty, true);

  async function saveDraft() {
    if (builder.isSaving) return;

    const formValues = form.getValues();

    if (builder.lineItems.length === 0) {
      builder.setError('At least one line item is required');
      return;
    }

    const hasEmptyDescription = builder.lineItems.some((item) => !item.description.trim());
    if (hasEmptyDescription) {
      builder.setError('All line items must have a description');
      return;
    }

    builder.setIsSaving(true);
    builder.setError(null);

    try {
      const lineItems = builder.lineItems.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate,
        sortOrder: item.sortOrder,
      }));

      const body = {
        opportunityId: formValues.opportunityId || null,
        contactId: formValues.contactId || null,
        title: formValues.title,
        status: formValues.status,
        currency: formValues.currency,
        validUntil: formValues.validUntil || null,
        notes: formValues.notes || null,
        lineItems,
      };

      const isUpdate = isEdit && proposalId;
      const res = await fetch(isUpdate ? `${API_BASE}/${proposalId}` : API_BASE, {
        method: isUpdate ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error((errData as { error?: string }).error || 'Failed to save proposal');
      }

      const saved = await res.json();

      builder.markSaved();
      form.reset({
        title: saved.title,
        contactId: saved.contactId,
        opportunityId: saved.opportunityId,
        currency: saved.currency,
        validUntil: saved.validUntil,
        notes: saved.notes,
        status: saved.status,
      });

      const updatedItems: LineItem[] = (saved.items || []).map((item: Record<string, unknown>) => {
        const it = item;
        return {
          id: String(it.id),
          description: String(it.description),
          quantity: String(it.quantity ?? '1'),
          unitPrice: String(it.unitPrice ?? '0'),
          taxRate: String(it.taxRate ?? '0'),
          sortOrder: Number(it.sortOrder ?? 0),
        };
      });
      builder.setLineItems(updatedItems);

      toast({
        title: 'Saved',
        description: isUpdate ? 'Proposal updated successfully.' : 'Proposal draft created.',
      });

      if (!isEdit && saved.id) {
        router.push(`/sales/proposals/${saved.id}/edit`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save proposal';
      builder.setError(message);
      toast({
        title: 'Save Failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      builder.setIsSaving(false);
    }
  }

  function handleDiscard() {
    setShowDiscardDialog(false);
    router.push('/sales/proposals');
  }

  React.useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (builder.isDirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [builder.isDirty]);

  const previewData = {
    title: builder.documentInfo.title,
    number: isEdit && existingProposal ? existingProposal.number : null,
    contact: contacts.find((c) => c.id === builder.documentInfo.contactId),
    currency: builder.documentInfo.currency,
    validUntil: builder.documentInfo.validUntil,
    notes: builder.documentInfo.notes,
    createdAt: existingProposal?.createdAt ? new Date(existingProposal.createdAt) : null,
  };

  const isReadOnly =
    isEdit && existingProposal && !['draft', 'sent'].includes(existingProposal.status);

  const resolvedContact: { firstName?: string | null; lastName?: string | null } | null =
    previewData.contact ??
    (builder.documentInfo.contactId
      ? (contacts.find((c) => c.id === builder.documentInfo.contactId) ?? null)
      : null);

  return (
    <div className="space-y-6 p-6">
      <AlertDialog open={showDiscardDialog} onOpenChange={setShowDiscardDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Discard them and return to the proposals list?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowDiscardDialog(false)}>
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDiscard}>Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {builder.error && (
        <div className="rounded-md bg-destructive/10 p-4 text-sm text-destructive flex items-center gap-3">
          <span>{builder.error}</span>
        </div>
      )}

      <BuilderLayout
        isMobile={false}
        showPreview={true}
        isDirty={builder.isDirty}
        onSave={saveDraft}
        isSaving={builder.isSaving}
        saveLabel={isEdit ? 'Save Changes' : 'Create Proposal'}
        preview={
          <DocumentPreview
            documentInfo={{
              ...previewData,
              contact: resolvedContact,
            }}
            items={builder.lineItems}
            totals={builder.totals}
            isLoading={builder.isSaving}
          />
        }
      >
        <div className="space-y-6">
          <DocumentInfoForm
            info={builder.documentInfo}
            currencies={builder.CURRENCIES}
            contacts={contacts}
            opportunities={opportunities}
            loading={false}
            onChange={(updates) => {
              builder.setDocumentInfo(updates);
              if (updates.title !== undefined)
                form.setValue('title', updates.title, { shouldDirty: true });
              if (updates.contactId !== undefined)
                form.setValue('contactId', updates.contactId, { shouldDirty: true });
              if (updates.opportunityId !== undefined)
                form.setValue('opportunityId', updates.opportunityId, { shouldDirty: true });
              if (updates.currency !== undefined)
                form.setValue('currency', updates.currency, {
                  shouldDirty: true,
                });
              if (updates.validUntil !== undefined)
                form.setValue('validUntil', updates.validUntil, { shouldDirty: true });
              if (updates.notes !== undefined)
                form.setValue('notes', updates.notes, { shouldDirty: true });
              if (updates.status !== undefined)
                form.setValue('status', updates.status, {
                  shouldDirty: true,
                });
            }}
          />

          <Separator />

          <ClientSelector
            contacts={contacts}
            opportunities={opportunities}
            selectedContactId={builder.documentInfo.contactId}
            selectedOpportunityId={builder.documentInfo.opportunityId}
            onContactSelect={(id) => {
              builder.setDocumentInfo({ contactId: id });
              form.setValue('contactId', id, { shouldDirty: true });
              if (id) {
                form.setValue('opportunityId', null, {
                  shouldDirty: true,
                });
                builder.setDocumentInfo({ opportunityId: null });
              }
            }}
            onOpportunitySelect={(id) => {
              builder.setDocumentInfo({ opportunityId: id });
              form.setValue('opportunityId', id, { shouldDirty: true });
            }}
            loading={false}
          />

          <LineItemEditor
            items={builder.lineItems}
            totals={builder.totals}
            currency={builder.documentInfo.currency}
            onAdd={builder.addLineItem}
            onRemove={builder.removeLineItem}
            onUpdate={builder.updateLineItem}
            onReorder={builder.reorderLineItems}
            isLoading={Boolean(builder.isSaving || isReadOnly)}
          />

          {isReadOnly && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2 mb-4">
              <span>This proposal is {existingProposal.status} and cannot be edited.</span>
            </div>
          )}
        </div>
      </BuilderLayout>
    </div>
  );
}
