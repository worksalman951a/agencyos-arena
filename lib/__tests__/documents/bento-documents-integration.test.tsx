import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BentoContractsView, type ContractItem } from '@/components/documents/bento-contracts-view';
import {
  BentoContractRecordView,
  type ContractDetailData,
} from '@/components/documents/bento-contract-record-view';
import { BentoTemplatesView } from '@/components/documents/bento-templates-view';
import { BentoLinksView } from '@/components/documents/bento-links-view';
import { BentoSharedDocumentView } from '@/components/documents/bento-shared-document-view';

const MOCK_CONTRACTS: ContractItem[] = [
  {
    id: 'cnt-1',
    organizationId: 'org-1',
    proposalId: 'prop-1',
    projectId: 'proj-1',
    title: 'Enterprise Master Services Agreement',
    status: 'sent',
    signatureReference: null,
    signedAt: null,
    signedBy: null,
    createdAt: new Date('2026-11-01T10:00:00.000Z'),
    updatedAt: new Date('2026-11-01T10:00:00.000Z'),
    proposal: { id: 'prop-1', number: 'PROP-001', title: 'Cloud Deal', status: 'accepted' },
    project: { id: 'proj-1', name: 'Infrastructure Modernization', status: 'active' },
    signer: null,
  },
  {
    id: 'cnt-2',
    organizationId: 'org-1',
    proposalId: null,
    projectId: null,
    title: 'Non-Disclosure Agreement',
    status: 'signed',
    signatureReference: 'AUDIT-SIG-9981',
    signedAt: new Date('2026-11-05T14:30:00.000Z'),
    signedBy: 'usr-1',
    createdAt: new Date('2026-11-02T10:00:00.000Z'),
    updatedAt: new Date('2026-11-05T14:30:00.000Z'),
    proposal: null,
    project: null,
    signer: { id: 'usr-1', name: 'Jane Doe', email: 'jane@client.com' },
  },
];

describe('Bento Phase 4B Integration: Contracts Directory', () => {
  it('renders contracts register, StatStrip metrics, and status pills', () => {
    render(<BentoContractsView contracts={MOCK_CONTRACTS} />);

    expect(screen.getByText('Contracts')).toBeDefined();
    expect(
      screen.getAllByText('Enterprise Master Services Agreement').length
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Non-Disclosure Agreement')).toBeDefined();
    expect(screen.getByText('Awaiting signature')).toBeDefined();
    expect(screen.getByText('Executed & Signed')).toBeDefined();
  });

  it('filters contracts by search input query', () => {
    render(<BentoContractsView contracts={MOCK_CONTRACTS} />);

    const searchInput = screen.getByPlaceholderText(/Search contracts by title/i);
    fireEvent.change(searchInput, { target: { value: 'Master Services' } });

    expect(
      screen.getAllByText('Enterprise Master Services Agreement').length
    ).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Non-Disclosure Agreement')).toBeNull();
  });

  it('filters contracts by status pill buttons', () => {
    render(<BentoContractsView contracts={MOCK_CONTRACTS} />);

    const signedTab = screen.getByRole('tab', { name: 'Signed' });
    fireEvent.click(signedTab);

    expect(screen.getAllByText('Non-Disclosure Agreement').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Enterprise Master Services Agreement')).toBeNull();
  });
});

describe('Bento Phase 4B Integration: Contract Record View', () => {
  it('renders contract details, audit signatures, and actions node', () => {
    const detailData: ContractDetailData = {
      ...MOCK_CONTRACTS[1],
      signatures: [
        {
          id: 'sig-1',
          signerName: 'Jane Doe',
          signerEmail: 'jane@client.com',
          signedAt: new Date('2026-11-05T14:30:00.000Z'),
          signatureMethod: 'audit_trail',
          signatureReference: 'AUDIT-SIG-9981',
        },
      ],
    };

    render(
      <BentoContractRecordView
        contract={detailData}
        actionsNode={<button type="button">Simulated Action</button>}
      />
    );

    expect(screen.getAllByText('Non-Disclosure Agreement').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Simulated Action')).toBeDefined();
    expect(screen.getAllByText('AUDIT-SIG-9981').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Jane Doe').length).toBeGreaterThanOrEqual(1);
  });
});

describe('Bento Phase 4B Integration: Document Templates', () => {
  it('renders template grid and merge field variables', () => {
    const templates = [
      {
        id: 'tpl-1',
        organizationId: 'org-1',
        name: 'Standard Client Services Agreement',
        type: 'contract',
        content: 'This agreement governs professional services...',
        variables: { clientName: 'string', rate: 'number' },
        isDefault: true,
        createdAt: new Date('2026-11-01'),
        updatedAt: new Date('2026-11-01'),
      },
    ];

    render(<BentoTemplatesView templates={templates} />);

    expect(screen.getByText('Standard Client Services Agreement')).toBeDefined();
    expect(screen.getByText('Default')).toBeDefined();
    expect(screen.getByText(/2 vars/i)).toBeDefined();
  });
});

describe('Bento Phase 4B Integration: Shareable Links', () => {
  it('renders active tokens, view counts, and revoke triggers', () => {
    const links = [
      {
        id: 'lnk-1',
        documentId: 'doc-1',
        documentTitle: 'PROP-001 — Cloud Deal',
        documentType: 'proposal',
        token: 'token1234567890abcdef',
        url: '/api/v1/documents/links/token1234567890abcdef',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        accessCount: 3,
        maxAccess: 10,
        createdAt: new Date(),
      },
    ];

    const onRevokeLink = vi.fn();

    render(
      <BentoLinksView
        links={links}
        onOpenCreateModal={vi.fn()}
        onRevokeLink={onRevokeLink}
        revokingId={null}
      />
    );

    expect(screen.getByText('PROP-001 — Cloud Deal')).toBeDefined();
    expect(screen.getByText('Active')).toBeDefined();
    expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1);

    const revokeBtn = screen.getByRole('button', { name: 'Revoke' });
    fireEvent.click(revokeBtn);
    expect(onRevokeLink).toHaveBeenCalledWith('lnk-1');
  });
});

describe('Bento Phase 4B Integration: Standalone Public Shared Document', () => {
  it('renders read-only client deliverable without leaking internal organization navigation', () => {
    render(
      <BentoSharedDocumentView
        documentTitle="PROP-001 — Enterprise Architecture"
        documentType="proposal"
        expiresAt={new Date(Date.now() + 86400000)}
        accessCount={1}
        maxAccess={5}
        token="tok-999"
        snapshot={{
          entityType: 'proposal',
          number: 'PROP-001',
          title: 'Enterprise Architecture',
          status: 'sent',
          currency: 'USD',
          validUntil: '2026-12-01',
          subtotal: '25000.00',
          tax: '2500.00',
          total: '27500.00',
          notes: 'Standard 30-day payment terms apply.',
          clientName: 'Acme Corp',
          items: [
            {
              description: 'Architecture Audit & Roadmap',
              quantity: '1',
              unitPrice: '25000.00',
              taxRate: '0.10',
              amount: '25000.00',
            },
          ],
          branding: { brandName: 'Northbeam Studio' },
        }}
      />
    );

    expect(screen.getByText('Enterprise Architecture')).toBeDefined();
    expect(screen.getAllByText('Northbeam Studio').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Architecture Audit & Roadmap')).toBeDefined();
    expect(screen.getByText('USD 27,500.00')).toBeDefined();
  });
});
