/**
 * Regression tests for the Sales edit entry-point routes.
 *
 * `/sales/proposals/[id]/edit` and `/sales/quotations/[id]/edit` are server
 * components that redirect to the builder. They previously read `params.id`
 * synchronously, but Next.js 16 passes `params` as a Promise in the server
 * runtime too — so the redirect target was `.../builder/undefined` and the
 * builder opened empty.
 *
 * `redirect()` throws in Next.js, so the assertion also proves the redirect is
 * reached with the real route id.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRedirect } = vi.hoisted(() => ({
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}));

import ProposalEditPage from '@/app/sales/proposals/[id]/edit/page';
import QuotationEditPage from '@/app/sales/quotations/[id]/edit/page';

beforeEach(() => {
  mockRedirect.mockClear();
});

describe('Proposal edit entry point', () => {
  it('redirects to the builder with the awaited route id', async () => {
    const params = Promise.resolve({ id: 'prop_abc123' });

    await expect(ProposalEditPage({ params })).rejects.toThrow(
      'NEXT_REDIRECT:/sales/proposals/builder/prop_abc123'
    );
    expect(mockRedirect).toHaveBeenCalledWith('/sales/proposals/builder/prop_abc123');
  });

  it('never redirects with an unresolved (undefined) id', async () => {
    const params = Promise.resolve({ id: 'prop_xyz789' });

    await expect(ProposalEditPage({ params })).rejects.toThrow();

    const target = mockRedirect.mock.calls[0][0];
    expect(target).not.toContain('undefined');
    expect(target).toBe('/sales/proposals/builder/prop_xyz789');
  });
});

describe('Quotation edit entry point', () => {
  it('redirects to the builder with the awaited route id', async () => {
    const params = Promise.resolve({ id: 'quot_abc123' });

    await expect(QuotationEditPage({ params })).rejects.toThrow(
      'NEXT_REDIRECT:/sales/quotations/builder/quot_abc123'
    );
    expect(mockRedirect).toHaveBeenCalledWith('/sales/quotations/builder/quot_abc123');
  });

  it('never redirects with an unresolved (undefined) id', async () => {
    const params = Promise.resolve({ id: 'quot_xyz789' });

    await expect(QuotationEditPage({ params })).rejects.toThrow();

    const target = mockRedirect.mock.calls[0][0];
    expect(target).not.toContain('undefined');
    expect(target).toBe('/sales/quotations/builder/quot_xyz789');
  });
});
