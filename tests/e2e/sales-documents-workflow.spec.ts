/**
 * Phase 3B End-to-End Browser Workflow Coverage:
 *  - Contact -> Proposal Live Preview Builder -> Branded PDF Download -> Version Snapshot -> Accept Proposal
 *  - Proposal -> Project handoff (name & budget prefill -> Project Detail Contracts panel)
 *  - Proposal -> Quotation Builder prefill -> Accept Quotation -> Invoice -> Payment -> Financial Reports
 *  - Proposal -> Contract -> Authorized Signature & Audit Trail
 *  - Reusable Document Templates (create, inspect variables & body)
 *  - Public Client Share Link (/share/[token]) in an unauthenticated browser context
 */

import { readFile } from 'node:fs/promises';

import type { Locator, Page } from '@playwright/test';

import { expect, requireDatabase, test } from './fixtures';

requireDatabase();

/** A Bento panel, scoped to the rendered shell so hidden copies cannot match. */
function bentoPanel(page: Page, name: string | RegExp): Locator {
  return page
    .locator('#main-content')
    .locator('section')
    .filter({ has: page.getByRole('heading', { name }) });
}

test.describe('Phase 3B sales, documents, builder, and public sharing workflows', () => {
  test('drives CRM -> Proposal -> Project & Contract, Quotation -> Invoice -> Payment -> Reports, Templates, and Public Share Link', async ({
    authedPage: page,
    browser,
    api,
    account,
    appUrl,
  }) => {
    const authHeaders = {
      Cookie: `better-auth.session_token=${account.sessionToken}`,
      Origin: appUrl,
    };

    // 1. Seed a CRM Contact via API and open Contact Detail
    const contactRes = await api.post('/api/v1/crm/contacts', {
      headers: authHeaders,
      data: {
        firstName: 'Elena',
        lastName: 'Rostova',
        email: `elena-${Date.now()}@client.invalid`,
        status: 'active',
      },
    });
    expect(contactRes.status()).toBe(201);
    const contact = (await contactRes.json()) as { id: string };

    await page.goto(`/crm/contacts/${contact.id}`);
    // Bento shows the name twice: the page header and the identity panel. The
    // workflow is about the record page, so assert its visible level-1 heading.
    await expect(
      page.locator('#main-content').getByRole('heading', { name: /Elena Rostova/i, level: 1 })
    ).toBeVisible();

    // 2. Launch Proposal Live Builder directly from Contact Detail (+ New Proposal)
    await page.getByRole('link', { name: '+ New Proposal' }).click();
    await expect(page).toHaveURL(/\/sales\/proposals\/builder/);

    await page.locator('#title').fill('Enterprise Brand Refresh Proposal');
    if ((await page.getByPlaceholder('Description').count()) === 0) {
      await page.getByRole('button', { name: /Add Item/i }).click();
    }
    await page.getByPlaceholder('Description').first().fill('Brand Strategy & Design System');
    const firstRowNumberInputs = page
      .locator('table tbody tr')
      .first()
      .locator('input[type="number"]');
    await firstRowNumberInputs.nth(0).fill('2');
    await firstRowNumberInputs.nth(1).fill('1500');
    await firstRowNumberInputs.nth(2).fill('10');

    // Live preview updates totals in real time (2 * 1500 = 3000 + 10% tax = 3300.00)
    await expect(page.getByText('Enterprise Brand Refresh Proposal').first()).toBeVisible();
    await expect(page.getByText(/3,?300\.00/).first()).toBeVisible();

    await page.getByRole('button', { name: 'Create Proposal' }).click();
    await expect(page).toHaveURL(/\/sales\/proposals\/builder\/[a-z0-9-]+$/i);
    const proposalId = page.url().split('/').pop()!;
    const proposalUrl = `/sales/proposals/${proposalId}`;
    await page.goto(proposalUrl);

    await expect(
      page.getByRole('heading', { name: 'Enterprise Brand Refresh Proposal', level: 1 })
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Elena Rostova' })).toBeVisible();

    // Verify the branded PDF export downloads a real .pdf file. Bento serves
    // the authoritative document endpoint, which names the file after the
    // document number instead of the old client-side `proposal-…` slug.
    const [pdfDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-pdf-button').click(),
    ]);
    expect(pdfDownload.suggestedFilename()).toMatch(/^Proposal_.+\.pdf$/i);
    const pdfPath = await pdfDownload.path();
    expect(pdfPath, 'the download must be written to disk').toBeTruthy();
    expect((await readFile(pdfPath!)).subarray(0, 5).toString()).toBe('%PDF-');

    // Save a version snapshot (v1) and verify Version History renders
    await page.getByRole('button', { name: 'Save Snapshot' }).click();
    const versions = bentoPanel(page, /^Version History/);
    await expect(versions).toBeVisible();
    await expect(versions.getByText('Version 1', { exact: true })).toBeVisible();

    // Mark as Sent -> Accept Proposal -> Edit button disappears (immutable)
    await page.getByRole('button', { name: 'Mark as Sent' }).click();
    await expect(page.getByRole('button', { name: 'Accept Proposal' })).toBeVisible();
    await page.getByRole('button', { name: 'Accept Proposal' }).click();
    await expect(page.getByRole('link', { name: 'Edit', exact: true })).toHaveCount(0);

    // 3. Generate a Client Share Link right from Proposal Detail and verify in an unauthenticated context
    await page.getByTestId('share-document-button').click();
    const [shareLinkRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/v1/documents/links') && r.request().method() === 'POST'
      ),
      page.getByRole('button', { name: 'Generate Share Link' }).click(),
    ]);
    expect(shareLinkRes.status()).toBe(201);
    const createdShare = (await shareLinkRes.json()) as { token: string; publicUrl: string };

    const publicContext = await browser.newContext();
    const publicPage = await publicContext.newPage();
    await publicPage.goto(`${appUrl}/share/${createdShare.token}`);
    await expect(
      publicPage.getByRole('heading', { name: 'Enterprise Brand Refresh Proposal' })
    ).toBeVisible();
    await expect(publicPage.getByText('Brand Strategy & Design System')).toBeVisible();
    await expect(publicPage.getByText(/3,300\.00/).first()).toBeVisible();

    // Invalid token shows clean unavailable state
    await publicPage.goto(`${appUrl}/share/nonexistent-token-check`);
    await expect(publicPage.getByRole('heading', { name: 'Link Unavailable' })).toBeVisible();
    await publicContext.close();

    // 4. Sales -> Projects handoff: Create Project from Proposal Detail (name & budget prefilled)
    await page.goto(proposalUrl);
    await page.getByRole('link', { name: 'Create Project' }).click();
    await expect(page).toHaveURL(/\/projects\/new/);
    await expect(page.locator('#bento-project-name')).toHaveValue(
      'Enterprise Brand Refresh Proposal'
    );
    await expect(page.locator('#bento-project-budget')).toHaveValue(/^3300(\.00)?$/);
    // Bento repeats the submit action in the page header and the form footer.
    await bentoPanel(page, 'Project Parameters & Scope')
      .getByRole('button', { name: 'Create Project' })
      .click();
    await expect(page).toHaveURL(/\/projects\/[a-z0-9-]+$/i);
    await expect(bentoPanel(page, 'Associated Contracts')).toContainText(
      'No active contracts linked to this project.'
    );

    // 5. Sales -> Contract -> Authorized Signature & Audit Trail
    await page.goto(proposalUrl);
    await page.getByRole('link', { name: 'Create Contract' }).click();
    await expect(page).toHaveURL(/\/documents\/contracts\/new/);
    await expect(page.locator('#bento-contract-title')).toHaveValue(
      'Enterprise Brand Refresh Proposal'
    );

    await bentoPanel(page, 'Contract Parameters & Scope')
      .getByRole('button', { name: 'Create Contract' })
      .click();
    await expect(page).toHaveURL(/\/documents\/contracts\/[a-z0-9-]+$/i);

    await page.getByRole('button', { name: 'Sign Contract' }).click();
    await page.locator('#signer-name').fill('Elena Rostova');
    await page.locator('#signer-email').fill('elena@client.invalid');
    await page.getByRole('button', { name: 'Confirm Signature' }).click();

    await expect(page.getByRole('heading', { name: 'Signature Audit Trail' })).toBeVisible();
    await expect(bentoPanel(page, /^Signature Audit Trail/)).toContainText('elena@client.invalid');
    await expect(page.getByRole('link', { name: 'Edit', exact: true })).toHaveCount(0);

    // 6. Proposal -> Quotation -> Invoice (default path) -> Payment -> Financial Reports
    await page.goto(proposalUrl);
    await page.getByRole('link', { name: 'Create Quotation' }).click();
    await expect(page).toHaveURL(/\/sales\/quotations\/builder/);

    await page.getByRole('button', { name: 'Create Quotation' }).click();
    await expect(page).toHaveURL(/\/sales\/quotations\/builder\/[a-z0-9-]+$/i);
    const quotationId = page.url().split('/').pop()!;
    await page.goto(`/sales/quotations/${quotationId}`);

    await page.getByRole('button', { name: 'Mark as Sent' }).click();
    await expect(page.getByRole('button', { name: 'Accept Quotation' })).toBeVisible();
    await page.getByRole('button', { name: 'Accept Quotation' }).click();

    // Estimates are retired from the active sales workflow: an accepted
    // quotation no longer offers an estimate handoff.
    await expect(page.getByRole('link', { name: 'Create Estimate' })).toHaveCount(0);

    // The default path is Quotation -> Invoice. No proposal or agreement is
    // required, and the invoice is prefilled from the quotation server-side.
    await page.getByRole('button', { name: 'Create Invoice' }).click();
    await expect(page).toHaveURL(/\/finance\/invoices\/[a-z0-9-]+$/i);

    const invoiceId = page.url().split('/').pop()!;
    await expect(page.getByRole('heading', { name: 'Source quotation' })).toBeVisible();
    await expect(page.locator('[data-testid="invoice-source-quotation"]')).toContainText(
      /QOT-\d{4}-\d{4}/
    );
    await expect(page.getByText(/3,?300\.00/).first()).toBeVisible();

    // The invoice carries the quotation's client, line items and pricing.
    const invoiceRes = await api.get(`/api/v1/crm/invoices/${invoiceId}`, {
      headers: authHeaders,
    });
    expect(invoiceRes.status()).toBe(200);
    const invoice = (await invoiceRes.json()) as {
      quotationId: string;
      status: string;
      total: string;
      items: Array<{ description: string; unitPrice: string; taxRate: string; amount: string }>;
    };
    expect(invoice.quotationId).toBe(quotationId);
    expect(invoice.status).toBe('draft');
    expect(invoice.total).toBe('3300.00');
    expect(invoice.items).toHaveLength(1);
    expect(invoice.items[0]).toMatchObject({
      description: 'Brand Strategy & Design System',
      unitPrice: '1500.00',
      taxRate: '10',
      amount: '3000.00',
    });
    const payRes = await api.post(`/api/v1/crm/invoices/${invoiceId}/payments`, {
      headers: authHeaders,
      data: {
        amount: '3300.00',
        method: 'bank_transfer',
        reference: `E2E-PAY-${Date.now()}`,
      },
    });
    expect(payRes.status()).toBe(201);

    await page.goto('/finance/reports');
    await expect(page.getByRole('heading', { name: /Financial Reports/i })).toBeVisible();
    await expect(page.getByText(/3,?300\.00/).first()).toBeVisible();

    // 7. Create a reusable Document Template and verify Template Detail renders merge variables
    await page.goto('/documents/templates/new');
    await page.locator('#bento-doc-tpl-name').fill('Standard Retainer SOW');
    await page.locator('#bento-doc-tpl-vars').fill('client_name, retainer_hours');
    await page
      .locator('#bento-doc-tpl-content')
      .fill('Prepared for {{client_name}} covering {{retainer_hours}} monthly hours.');
    await bentoPanel(page, 'Template Specifications & Content')
      .getByRole('button', { name: 'Create Template' })
      .click();

    await expect(page).toHaveURL(/\/documents\/templates\/[a-z0-9-]+$/i);
    await expect(
      page.getByRole('heading', { name: 'Standard Retainer SOW', level: 1 })
    ).toBeVisible();
    await expect(page.getByText('{{client_name}}').first()).toBeVisible();
    await expect(page.getByText('{{retainer_hours}}').first()).toBeVisible();
  });

  /**
   * The optional middle step: Quotation -> Agreement -> Invoice, starting from a
   * quotation created directly (no proposal). Also pins that the estimate
   * creation flow is gone and that the source quotation link survives on both
   * produced documents.
   */
  test('drives a direct quotation -> agreement -> invoice without a proposal', async ({
    authedPage: page,
    api,
    account,
    appUrl,
  }) => {
    const authHeaders = {
      Cookie: `better-auth.session_token=${account.sessionToken}`,
      Origin: appUrl,
    };

    // 1. Seed a contact and create a quotation directly, without a proposal.
    const contactRes = await api.post('/api/v1/crm/contacts', {
      headers: authHeaders,
      data: {
        firstName: 'Grace',
        lastName: 'Hopper',
        email: `grace-${Date.now()}@client.invalid`,
        status: 'active',
      },
    });
    expect(contactRes.status()).toBe(201);
    const contact = (await contactRes.json()) as { id: string };

    const quotationRes = await api.post('/api/v1/crm/quotations', {
      headers: authHeaders,
      data: {
        contactId: contact.id,
        title: 'Direct Retainer Quotation',
        currency: 'USD',
        notes: 'No proposal precedes this quotation.',
        lineItems: [
          {
            description: 'Monthly Retainer',
            quantity: '1',
            unitPrice: '2400',
            taxRate: '10',
            sortOrder: 0,
          },
        ],
      },
    });
    expect(quotationRes.status()).toBe(201);
    const quotation = (await quotationRes.json()) as {
      id: string;
      number: string;
      status: string;
      total: string;
    };
    // Created without a proposal; server-calculated 2400 + 10% = 2640.
    expect(quotation.status).toBe('draft');
    expect(quotation.total).toBe('2640.00');

    // 2. Accept it through the real lifecycle endpoints.
    for (const status of ['sent', 'accepted']) {
      const transition = await api.put(`/api/v1/crm/quotations/${quotation.id}`, {
        headers: authHeaders,
        data: { status },
      });
      expect(transition.status()).toBe(200);
    }

    await page.goto(`/sales/quotations/${quotation.id}`);
    await expect(page.getByRole('button', { name: 'Create Agreement' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Invoice' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create Estimate' })).toHaveCount(0);

    // 3. Create the agreement first (optional path). It keeps the source link.
    await page.getByRole('button', { name: 'Create Agreement' }).click();
    await expect(page).toHaveURL(/\/documents\/contracts\/[a-z0-9-]+$/i);
    await expect(
      page.getByRole('link', { name: new RegExp(`#${quotation.number}`) })
    ).toBeVisible();

    // 4. Back on the quotation, the agreement is now linked instead of offered
    //    again, and the invoice can still be created from the same source.
    await page.goto(`/sales/quotations/${quotation.id}`);
    await expect(page.getByRole('link', { name: 'Open Agreement' })).toBeVisible();

    await page.getByRole('button', { name: 'Create Invoice' }).click();
    await expect(page).toHaveURL(/\/finance\/invoices\/[a-z0-9-]+$/i);
    const invoiceId = page.url().split('/').pop()!;
    await expect(page.locator('[data-testid="invoice-source-quotation"]')).toContainText(
      quotation.number
    );
    await expect(page.getByText(/2,?640\.00/).first()).toBeVisible();

    // 5. Source data is on the invoice, and both documents point at the
    //    quotation they came from.
    const invoiceRes = await api.get(`/api/v1/crm/invoices/${invoiceId}`, {
      headers: authHeaders,
    });
    expect(invoiceRes.status()).toBe(200);
    const invoice = (await invoiceRes.json()) as {
      quotationId: string;
      clientId: string;
      total: string;
      items: Array<{ description: string; unitPrice: string; taxRate: string; amount: string }>;
    };
    expect(invoice.quotationId).toBe(quotation.id);
    expect(invoice.clientId).toBe(contact.id);
    expect(invoice.total).toBe('2640.00');
    expect(invoice.items[0]).toMatchObject({
      description: 'Monthly Retainer',
      unitPrice: '2400.00',
      taxRate: '10',
      amount: '2400.00',
    });

    const quotationAfter = await api.get(`/api/v1/crm/quotations/${quotation.id}`, {
      headers: authHeaders,
    });
    const quotationBody = (await quotationAfter.json()) as {
      invoices: Array<{ id: string }>;
      contracts: Array<{ id: string }>;
    };
    expect(quotationBody.invoices.map((row) => row.id)).toContain(invoiceId);
    expect(quotationBody.contracts.length).toBe(1);
  });

  /**
   * Estimates are historical and read-only.
   *
   * The record stays readable (and its PDF downloadable) for a caller who still
   * has a link, but no mutation surface may be shipped and the API must refuse
   * every verb. This is the browser-level twin of
   * `lib/__tests__/sales/estimate-read-only.test.ts`.
   */
  test('shows historical estimates as read-only records with no mutation actions', async ({
    authedPage: page,
    api,
    account,
    appUrl,
  }) => {
    const authHeaders = {
      Cookie: `better-auth.session_token=${account.sessionToken}`,
      Origin: appUrl,
    };

    // Creation is refused, so the browser has no way to produce an estimate
    // either; asserting the refusal here keeps the two layers in sync.
    const createAttempt = await api.post('/api/v1/finance/estimates', {
      headers: authHeaders,
      data: {
        clientId: '000000000000000000000000',
        number: `EST-E2E-${Date.now()}`,
        status: 'draft',
        total: '100.00',
        currency: 'USD',
      },
    });
    expect(createAttempt.status()).toBe(403);
    expect(await createAttempt.json()).toMatchObject({ code: 'estimate_read_only' });

    // The register is still reachable (it is not in navigation, but a bookmark
    // or an audit link must keep working) and offers no create/edit control.
    await page.goto('/finance/estimates');
    // The level-1 heading differs per shell ("Estimates" in the legacy shell,
    // "Estimates" inside the Bento banner), so assert the page banner text the
    // legend renders in both and the absence of mutation controls.
    await expect(page.getByText(/Estimates are kept for history/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /New Estimate|Create Estimate/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0);
    await expect(page.getByText(/read-only/i).first()).toBeVisible();
  });
});
