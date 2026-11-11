/**
 * Phase 3B End-to-End Browser Workflow Coverage:
 *  - Contact -> Proposal Live Preview Builder -> Branded PDF Download -> Version Snapshot -> Accept Proposal
 *  - Proposal -> Project handoff (name & budget prefill -> Project Detail Contracts panel)
 *  - Proposal -> Quotation Builder prefill -> Accept Quotation -> Estimate -> Invoice -> Payment -> Financial Reports
 *  - Proposal -> Contract -> Authorized Signature & Audit Trail
 *  - Reusable Document Templates (create, inspect variables & body)
 *  - Public Client Share Link (/share/[token]) in an unauthenticated browser context
 */

import { expect, requireDatabase, test } from './fixtures';

requireDatabase();

test.describe('Phase 3B sales, documents, builder, and public sharing workflows', () => {
  test('drives CRM -> Proposal -> Project & Contract, Quotation -> Estimate -> Invoice -> Payment -> Reports, Templates, and Public Share Link', async ({
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
    await expect(page.getByRole('heading', { name: /Elena Rostova/i })).toBeVisible();

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
    await expect(page.getByText(/3,300\.00/).first()).toBeVisible();

    await page.getByRole('button', { name: 'Create Proposal' }).click();
    await expect(page).toHaveURL(/\/sales\/proposals\/builder\/[a-z0-9-]+$/i);
    const proposalId = page.url().split('/').pop()!;
    const proposalUrl = `/sales/proposals/${proposalId}`;
    await page.goto(proposalUrl);

    await expect(
      page.getByRole('heading', { name: 'Enterprise Brand Refresh Proposal', level: 1 })
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Elena Rostova' })).toBeVisible();

    // Verify branded client-side PDF generation downloads a real .pdf file
    const [pdfDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-pdf-button').click(),
    ]);
    expect(pdfDownload.suggestedFilename()).toMatch(/^proposal-.*\.pdf$/i);

    // Save a version snapshot (v1) and verify Version History renders
    await page.getByRole('button', { name: 'Save Snapshot' }).click();
    await expect(page.getByRole('heading', { name: 'Version History' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'v1' })).toBeVisible();

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
    await expect(page.locator('#project-name')).toHaveValue('Enterprise Brand Refresh Proposal');
    await expect(page.locator('#project-budget')).toHaveValue(/^3300(\.00)?$/);
    await page.getByRole('button', { name: 'Create Project' }).click();
    await expect(page).toHaveURL(/\/projects\/[a-z0-9-]+$/i);
    await expect(page.getByRole('heading', { name: /Contracts \(0\)/ })).toBeVisible();

    // 5. Sales -> Contract -> Authorized Signature & Audit Trail
    await page.goto(proposalUrl);
    await page.getByRole('link', { name: 'Create Contract' }).click();
    await expect(page).toHaveURL(/\/documents\/contracts\/new/);
    await expect(page.locator('#contract-title')).toHaveValue('Enterprise Brand Refresh Proposal');

    await page.getByRole('button', { name: 'Create Contract' }).click();
    await expect(page).toHaveURL(/\/documents\/contracts\/[a-z0-9-]+$/i);

    await page.getByRole('button', { name: 'Sign Contract' }).click();
    await page.locator('#signer-name').fill('Elena Rostova');
    await page.locator('#signer-email').fill('elena@client.invalid');
    await page.getByRole('button', { name: 'Confirm Signature' }).click();

    await expect(page.getByRole('heading', { name: 'Signature Audit Trail' })).toBeVisible();
    await expect(page.getByText('elena@client.invalid')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit', exact: true })).toHaveCount(0);

    // 6. Proposal -> Quotation -> Estimate -> Invoice -> Payment -> Financial Reports
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

    await page.getByRole('link', { name: 'Create Estimate' }).click();
    await expect(page).toHaveURL(/\/finance\/estimates\/new/);
    await expect(page.locator('#estimate-total')).toHaveValue(/^3300(\.00)?$/);

    await page.getByRole('button', { name: 'Create Estimate' }).click();
    await expect(page).toHaveURL(/\/finance\/estimates\/[a-z0-9-]+$/i);

    await page.getByRole('button', { name: 'Accept Estimate' }).click();
    await page.getByRole('link', { name: 'Convert to Invoice' }).first().click();
    await expect(page).toHaveURL(/\/finance\/estimates\/[a-z0-9-]+\/convert$/i);
    await page.locator('input[type="text"]').first().fill('Brand Refresh Milestone 1 Invoice');
    await page.getByRole('button', { name: 'Convert to Invoice' }).click();
    await expect(page.getByRole('heading', { name: 'Invoice created' })).toBeVisible();
    await page.getByRole('link', { name: 'Open invoice' }).click();
    await expect(page).toHaveURL(/\/finance\/invoices\/[a-z0-9-]+$/i);

    const invoiceId = page.url().split('/').pop()!;
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
    await expect(page.getByText(/3,300\.00/).first()).toBeVisible();

    // 7. Create a reusable Document Template and verify Template Detail renders merge variables
    await page.goto('/documents/templates/new');
    await page.locator('#template-name').fill('Standard Retainer SOW');
    await page.locator('#template-variables').fill('client_name, retainer_hours');
    await page
      .locator('#template-content')
      .fill('Prepared for {{client_name}} covering {{retainer_hours}} monthly hours.');
    await page.getByRole('button', { name: 'Create Template' }).click();

    await expect(page).toHaveURL(/\/documents\/templates\/[a-z0-9-]+$/i);
    await expect(
      page.getByRole('heading', { name: 'Standard Retainer SOW', level: 1 })
    ).toBeVisible();
    await expect(page.getByText('{{client_name}}').first()).toBeVisible();
    await expect(page.getByText('{{retainer_hours}}').first()).toBeVisible();
  });
});
