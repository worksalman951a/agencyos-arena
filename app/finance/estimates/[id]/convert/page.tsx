/**
 * AgencyOS Convert Estimate to Invoice page.
 *
 * Converts an accepted estimate into a draft invoice.
 *
 * The invoice number is **not** an input: it is assigned by the organization's
 * document allocator inside the conversion transaction, and the page shows the
 * number the server actually allocated once the conversion succeeds.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

interface ConvertedInvoice {
  invoiceId: string;
  invoiceNumber: string;
}

export default function ConvertEstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [id, setId] = useState<string>('');
  const [estimate, setEstimate] = useState<{
    id: string;
    number: string;
    status: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState(false);
  const [converted, setConverted] = useState<ConvertedInvoice | null>(null);

  useEffect(() => {
    params.then(async ({ id: pid }) => {
      setId(pid);
      try {
        const res = await fetch(`/api/v1/finance/estimates/${pid}`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          toast.error('Failed to load estimate');
          router.push('/finance/estimates');
          return;
        }
        const data = await res.json();
        setEstimate({
          id: data.id,
          number: data.number,
          status: data.status,
        });
      } catch (err) {
        toast.error((err as Error).message);
        router.push('/finance/estimates');
      } finally {
        setLoading(false);
      }
    });
  }, [params, router]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 text-muted-foreground">Loading estimate...</div>
      </div>
    );
  }

  if (!estimate) {
    return null;
  }

  if (estimate.status !== 'accepted') {
    return (
      <div className="space-y-6 p-6">
        <h1 className="text-2xl font-bold">Convert Estimate</h1>
        <div className="rounded-md border bg-amber-50 p-4">
          <h2 className="text-lg font-semibold mb-2">Cannot Convert</h2>
          <p className="text-sm text-amber-800">
            Only accepted estimates can be converted to invoices. This estimate is currently
            {estimate.status}.
          </p>
        </div>
        <Link
          href={`/finance/estimates/${id}`}
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Back to Estimate
        </Link>
      </div>
    );
  }

  const handleConvert = async (invoiceTitle: string, dueDate: string) => {
    setConverting(true);
    try {
      const res = await fetch(`/api/v1/finance/estimates/${id}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceTitle,
          dueDate: dueDate || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to convert estimate');
      }

      const invoice = (await res.json()) as { invoiceId: string; invoiceNumber: string };
      setConverted({ invoiceId: invoice.invoiceId, invoiceNumber: invoice.invoiceNumber });
      toast.success(`Invoice ${invoice.invoiceNumber} created`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setConverting(false);
    }
  };

  if (converted) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <h1 className="text-2xl font-bold">Convert to Invoice</h1>
          <Link
            href={`/finance/estimates/${id}`}
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
          >
            Back to Estimate
          </Link>
        </div>

        <div className="rounded-md border bg-background p-6 max-w-2xl">
          <h2 className="text-lg font-semibold mb-2">Invoice created</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Estimate {estimate.number} was converted and its status is now{' '}
            <strong>converted</strong>.
          </p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm mb-6">
            <div className="border rounded-md p-3">
              <dt className="text-xs text-muted-foreground uppercase">Invoice number</dt>
              <dd className="font-medium text-lg" data-testid="converted-invoice-number">
                {converted.invoiceNumber}
              </dd>
            </div>
            <div className="border rounded-md p-3">
              <dt className="text-xs text-muted-foreground uppercase">Status</dt>
              <dd className="font-medium text-lg">Draft</dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground mb-4">
            The invoice number was assigned by this workspace&apos;s document numbering.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href={`/finance/invoices/${converted.invoiceId}`}
              className="px-6 py-3 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90"
            >
              Open invoice
            </Link>
            <Link
              href="/finance/invoices"
              className="px-6 py-3 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
            >
              All invoices
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Convert to Invoice</h1>
        <Link
          href={`/finance/estimates/${id}`}
          className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80"
        >
          Back to Estimate
        </Link>
      </div>

      <div className="rounded-md border bg-background p-6 max-w-2xl">
        <h2 className="text-lg font-semibold mb-4">Convert Estimate #{estimate.number}</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Creating an invoice from this accepted estimate. The invoice will be in draft status and
          its number is assigned automatically.
        </p>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.target as HTMLFormElement);
            handleConvert(
              formData.get('invoiceTitle') as string,
              formData.get('dueDate') as string
            );
          }}
        >
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="invoiceTitle">
              Invoice Title
            </label>
            <input
              type="text"
              id="invoiceTitle"
              name="invoiceTitle"
              defaultValue={`Invoice for Estimate ${estimate.number}`}
              className="border border-input rounded-md px-3 py-2 text-sm w-full"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="dueDate">
              Due Date
            </label>
            <input
              type="date"
              id="dueDate"
              name="dueDate"
              className="border border-input rounded-md px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={converting}
            className="px-6 py-3 bg-accent text-accent-foreground rounded-md text-sm font-medium disabled:opacity-50 hover:bg-accent/90"
          >
            {converting ? 'Converting...' : 'Convert to Invoice'}
          </button>
        </form>
      </div>
    </div>
  );
}
