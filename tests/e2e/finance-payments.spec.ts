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

import { expect, requireDatabase, test } from './fixtures';
import type { TestAccount } from './fixtures';

requireDatabase();

const authHeader = (account: TestAccount) => ({
  Cookie: `better-auth.session_token=${account.sessionToken}`,
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

    // Currencies are reported on separate rows and never combined.
    const usdRow = page.getByRole('row', { name: /USD/ }).first();
    await expect(usdRow).toContainText('40.00');
    await expect(usdRow).toContainText('60.00');

    const eurRow = page.getByRole('row', { name: /EUR/ }).first();
    await expect(eurRow).toContainText('50.00');
    await expect(eurRow).toContainText('150.00');

    // The old page rendered a single USD total across all currencies.
    await expect(page.getByText('$250.00')).toHaveCount(0);
  });
});
