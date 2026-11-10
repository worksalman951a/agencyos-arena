'use client';

import * as React from 'react';
import { listCurrencies } from '@/lib/currencies';

/**
 * Builder state management for Proposals and Quotations.
 *
 * Handles document info, line items, totals calculation (integer-cent),
 * and dirty-tracking for unsaved-changes warnings.
 *
 * Totals are derived from line items via useMemo (no cascading renders).
 */

export type LineItem = {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  sortOrder: number;
};

export type DocumentInfo = {
  title: string;
  contactId: string | null;
  opportunityId: string | null;
  currency: string;
  validUntil: string | null;
  notes: string | null;
  status: string;
};

export type BuilderTotals = {
  subtotal: string;
  tax: string;
  total: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
};

export type BuilderCoreState = {
  documentInfo: DocumentInfo;
  lineItems: LineItem[];
  isDirty: boolean;
  isSaving: boolean;
  error: string | null;
};

// Every ISO currency the runtime knows about (searchable in the builder), rather
// than a four-entry hardcoded list. The default comes from the organization's
// settings via `initialInfo.currency`.
const CURRENCIES = listCurrencies().map((currency) => currency.code);

const INITIAL_DOCUMENT_INFO: DocumentInfo = {
  title: '',
  contactId: null,
  opportunityId: null,
  currency: 'USD',
  validUntil: null,
  notes: null,
  status: 'draft',
};

const INITIAL_STATE: BuilderCoreState = {
  documentInfo: INITIAL_DOCUMENT_INFO,
  lineItems: [],
  isDirty: false,
  isSaving: false,
  error: null,
};

/** Convert a decimal string to cents (integer) for safe money math */
export function toCents(value: string): number {
  const num = parseDecimal(value);
  return Math.round(num * 100);
}

/** Parse a decimal string safely, defaulting to 0 */
export function parseDecimal(value: string): number {
  const parsed = Number(value);
  return isNaN(parsed) ? 0 : parsed;
}

/** Format cents as a 2-decimal string */
export function formatMoney(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Calculate totals from line items using integer-cent math */
export function calculateTotals(items: LineItem[]): BuilderTotals {
  let subtotalCents = 0;
  let taxCents = 0;

  for (const item of items) {
    const qtyCents = toCents(item.quantity);
    const priceCents = toCents(item.unitPrice);
    const rate = parseDecimal(item.taxRate);

    const itemAmountCents = Math.round((qtyCents * priceCents) / 100);
    const itemTaxCents = Math.round((itemAmountCents * rate) / 100);

    subtotalCents += itemAmountCents;
    taxCents += itemTaxCents;
  }

  return {
    subtotal: formatMoney(subtotalCents),
    tax: formatMoney(taxCents),
    total: formatMoney(subtotalCents + taxCents),
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
  };
}

export function useBuilderState(
  initialInfo: Partial<DocumentInfo> = {},
  initialItems: LineItem[] = []
) {
  const [state, setState] = React.useState<BuilderCoreState>(() => ({
    ...INITIAL_STATE,
    documentInfo: {
      ...INITIAL_DOCUMENT_INFO,
      ...initialInfo,
    },
    lineItems:
      initialItems.length > 0
        ? initialItems
        : [
            {
              id: crypto.randomUUID(),
              description: '',
              quantity: '1',
              unitPrice: '0',
              taxRate: '0',
              sortOrder: 0,
            },
          ],
  }));

  // Derive totals from line items (no cascading renders)
  const totals = React.useMemo(() => calculateTotals(state.lineItems), [state.lineItems]);

  const setDocumentInfo = React.useCallback((updates: Partial<DocumentInfo>) => {
    setState((prev) => ({
      ...prev,
      documentInfo: { ...prev.documentInfo, ...updates },
      isDirty: true,
      error: null,
    }));
  }, []);

  const addLineItem = React.useCallback(() => {
    setState((prev) => {
      const newItem: LineItem = {
        id: crypto.randomUUID(),
        description: '',
        quantity: '1',
        unitPrice: '0',
        taxRate: '0',
        sortOrder: prev.lineItems.length,
      };
      return {
        ...prev,
        lineItems: [...prev.lineItems, newItem],
        isDirty: true,
        error: null,
      };
    });
  }, []);

  const removeLineItem = React.useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      lineItems: prev.lineItems.filter((item) => item.id !== id),
      isDirty: true,
      error: null,
    }));
  }, []);

  const updateLineItem = React.useCallback((id: string, field: keyof LineItem, value: string) => {
    setState((prev) => ({
      ...prev,
      lineItems: prev.lineItems.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      ),
      isDirty: true,
      error: null,
    }));
  }, []);

  const reorderLineItems = React.useCallback((fromIndex: number, toIndex: number) => {
    setState((prev) => {
      const items = [...prev.lineItems];
      const [moved] = items.splice(fromIndex, 1);
      items.splice(toIndex, 0, moved);
      items.forEach((item, index) => {
        item.sortOrder = index;
      });
      return {
        ...prev,
        lineItems: items,
        isDirty: true,
        error: null,
      };
    });
  }, []);

  const setLineItems = React.useCallback((items: LineItem[]) => {
    setState((prev) => ({
      ...prev,
      lineItems: items,
      isDirty: true,
      error: null,
    }));
  }, []);

  const setError = React.useCallback((error: string | null) => {
    setState((prev) => ({ ...prev, error }));
  }, []);

  const setIsSaving = React.useCallback((isSaving: boolean) => {
    setState((prev) => ({ ...prev, isSaving }));
  }, []);

  const markSaved = React.useCallback(() => {
    setState((prev) => ({ ...prev, isDirty: false, error: null }));
  }, []);

  const reset = React.useCallback(() => {
    setState({
      ...INITIAL_STATE,
      lineItems: [
        {
          id: crypto.randomUUID(),
          description: '',
          quantity: '1',
          unitPrice: '0',
          taxRate: '0',
          sortOrder: 0,
        },
      ],
    });
  }, []);

  return {
    ...state,
    totals,
    CURRENCIES,
    setDocumentInfo,
    addLineItem,
    removeLineItem,
    updateLineItem,
    reorderLineItems,
    setLineItems,
    setError,
    setIsSaving,
    markSaved,
    reset,
  };
}
