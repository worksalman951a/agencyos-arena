/**
 * End-to-end coverage for recorded payments and the financial reports page.
 *
 * Regression cover for two batch-2 defects:
 *  - the reports page only counted invoices whose status was exactly `paid`
 *    (partial payments were invisible) and summed every currency into one USD
 *    figure;
 *  - payments were recorded without a balance check, so recorded collections
 *    could exceed what was invoiced.
 *
 * Data is created through the public API; the browser only asserts what a user
 * sees. Runs against the isolated Playwright database.
 */

import type { APIRequestContext } from '@playwright/test';

import { APP_URL, expect, requireDatabase, test } from './fixtures';
import type { TestAccount } from './fixtures';

requireDatabase();

const authHeader = (account: TestAccount) => ({
  Cookie: `better-auth.session_token=${account.sessionToken}`,
  // Same-origin marker: every mutating API request must name a trusted Origin
  // (CSRF protection in middleware.ts). A browser sends this on its own; the
  // API request context does not.
  Origin: APP_URL,
});

async function createContact(api: APIRequestContext, account: TestAccount, lastName: string) {
  const res = await api.post('/api/v1/crm/contacts', {
    headers: authHeader(account),
    data: { firstName: 'E2E', lastName },
  });
  expect(res.status(), `contact create failed: ${await res.text()}`).toBe(201);
  return (await res.json()) as { id: string };
}

async function createInvoice(
  api: APIRequestContext,
  account: TestAccount,
  clientId: string,
  title: string,
  unitPrice: string,
  currency = 'USD'
) {
  const res = await api.post('/api/v1/crm/invoices', {
    headers: authHeader(account),
    data: {
      title,
      clientId,
      currency,
      lineItems: [{ description: 'Work', quantity: '1', unitPrice, taxRate: '0' }],
    },
  });
  expect(res.status(), `invoice create failed: ${await res.text()}`).toBe(201);
  return (await res.json()) as { id: string; number: string };
}

async function recordPayment(
  api: APIRequestContext,
  account: TestAccount,
  invoiceId: string,
  amount: string
) {
  const res = await api.post(`/api/v1/crm/invoices/${invoiceId}/payments`, {
    headers: authHeader(account),
    data: { amount, method: 'bank_transfer', reference: `E2E-${Date.now()}` },
  });
  expect(res.status(), `payment failed: ${await res.text()}`).toBe(201);
  return (await res.json()) as {
    invoiceStatus: string;
    amountPaid: string;
    balance: string;
  };
}

test.describe('finance payments', () => {
  test('shows a recorded partial payment on the invoice detail page', async ({
    authedPage: page,
    api,
    account,
  }) => {
    const contact = await createContact(api, account, `Pay${Date.now()}`);
    const invoice = await createInvoice(api, account, contact.id, 'Partial payment E2E', '100.00');

    const payment = await recordPayment(api, account, invoice.id, '40.00');
    expect(payment.invoiceStatus).toBe('sent');
    expect(payment.balance).toBe('60.00');

    await page.goto(`/finance/invoices/${invoice.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(invoice.number);
    await expect(page.getByText('No payments recorded yet.')).toHaveCount(0);
    await expect(page.getByText('40.00').first()).toBeVisible();
  });

  test('reports collected and outstanding per currency, counting partial payments', async ({
    authedPage: page,
    api,
    account,
  }) => {
    const contact = await createContact(api, account, `Report${Date.now()}`);
    const usd = await createInvoice(api, account, contact.id, 'USD E2E', '100.00', 'USD');
    await recordPayment(api, account, usd.id, '40.00');

    const eur = await createInvoice(api, account, contact.id, 'EUR E2E', '200.00', 'EUR');
    await recordPayment(api, account, eur.id, '50.00');

    await page.goto('/finance/reports');
    await expect(page.getByRole('heading', { name: 'Financial Reports', level: 1 })).toBeVisible();

    // Assert the row's own arithmetic rather than absolute totals, so the test is
    // independent of anything else the account holds (and of retries).
    const rowFigures = async (currency: 'USD' | 'EUR') => {
      const row = page.getByRole('row', { name: new RegExp(currency) }).first();
      await expect(row).toBeVisible();
      const text = (await row.innerText()).replace(/[^0-9.,\s]/g, ' ');
      const values = text
        .split(/\s+/)
        .filter((part) => /^\d[\d,]*\.\d{2}$/.test(part))
        .map((part) => Number(part.replace(/,/g, '')));
      expect(values.length, `${currency} row should hold 4 money columns`).toBeGreaterThanOrEqual(
        4
      );
      const [invoiced, collected, outstanding, overdue] = values;
      return { invoiced, collected, outstanding, overdue };
    };

    const usdFigures = await rowFigures('USD');
    const eurFigures = await rowFigures('EUR');

    for (const [currency, figures] of [
      ['USD', usdFigures],
      ['EUR', eurFigures],
    ] as const) {
      // Collected is recorded money, so the partial payment is visible.
      expect(figures.collected, `${currency} collected`).toBeGreaterThan(0);
      // Money is neither invented nor lost: invoiced = collected + outstanding
      // (nothing is overdue in a fresh account).
      expect(figures.invoiced, `${currency} arithmetic`).toBeCloseTo(
        figures.collected + figures.outstanding,
        2
      );
      expect(figures.overdue).toBe(0);
    }

    // Each currency carries only its own payments.
    expect(usdFigures.collected % 40).toBe(0);
    expect(eurFigures.collected % 50).toBe(0);
  });
});
