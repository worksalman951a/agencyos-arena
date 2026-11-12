/**
 * Portal resource registry (pure module).
 *
 * The portal shares a fixed, small set of internal resource types. Declaring
 * them here — with their capability requirements and labels — keeps grant
 * validation, the resource-existence check and the UI in agreement, and makes an
 * unknown `resourceType` a validation error instead of a silent no-op.
 */

export const PORTAL_RESOURCE_TYPES = [
  'project',
  'document',
  'proposal',
  'quotation',
  'estimate',
  'contract',
  'invoice',
  'file',
] as const;

export type PortalResourceType = (typeof PORTAL_RESOURCE_TYPES)[number];

export function isPortalResourceType(value: string): value is PortalResourceType {
  return (PORTAL_RESOURCE_TYPES as readonly string[]).includes(value);
}

export const PORTAL_RESOURCE_LABELS: Record<PortalResourceType, string> = {
  project: 'Project',
  document: 'Document',
  proposal: 'Proposal',
  quotation: 'Quotation',
  estimate: 'Estimate',
  contract: 'Contract',
  invoice: 'Invoice',
  file: 'File',
};

/**
 * Extra capability a client needs in addition to a grant, by resource type.
 * `null` means the grant alone is enough.
 */
export const RESOURCE_REQUIRED_CAPABILITY: Record<
  PortalResourceType,
  'viewInvoices' | 'downloadFiles' | null
> = {
  project: null,
  document: null,
  proposal: null,
  quotation: null,
  estimate: null,
  contract: null,
  invoice: 'viewInvoices',
  file: 'downloadFiles',
};

/** Portal route for a granted resource; files/invoices have their own views. */
export function portalResourceHref(type: PortalResourceType, id: string): string {
  switch (type) {
    case 'project':
      return `/portal/projects/${id}`;
    case 'invoice':
      return '/portal/invoices';
    case 'file':
      return '/portal/documents';
    default:
      return `/portal/documents?resource=${type}:${id}`;
  }
}

/**
 * Resource types a client may comment on or approve.
 *
 * Invoices are read-only by design: financial records are never mutated from the
 * client side, and approving an invoice amount is not something this phase
 * supports.
 */
export const COMMENTABLE_RESOURCE_TYPES: readonly PortalResourceType[] = [
  'project',
  'document',
  'proposal',
  'quotation',
  'estimate',
  'contract',
  'file',
];

export const APPROVABLE_RESOURCE_TYPES: readonly PortalResourceType[] = [
  'project',
  'document',
  'proposal',
  'quotation',
  'estimate',
  'contract',
];

export function canCommentOn(type: PortalResourceType): boolean {
  return COMMENTABLE_RESOURCE_TYPES.includes(type);
}

export function canApprove(type: PortalResourceType): boolean {
  return APPROVABLE_RESOURCE_TYPES.includes(type);
}
