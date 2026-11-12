/**
 * Client-portal capabilities (pure module).
 *
 * A client's abilities come from explicit boolean flags on `ClientAccess`, never
 * from the internal `Role`/`Permission` tables. Keeping this mapping in a pure
 * module lets the service layer, the UI and the tests share one definition — a
 * page that offers an action the service would reject is a bug, but the same
 * flag is read in both places.
 *
 * Imports nothing: safe for client components and unit tests.
 */

/** Capability name -> column on ClientAccess. */
export const CLIENT_CAPABILITY_COLUMNS = {
  viewInvoices: 'canViewInvoices',
  downloadFiles: 'canDownloadFiles',
  comment: 'canComment',
  approve: 'canApprove',
} as const;

export type ClientCapability = keyof typeof CLIENT_CAPABILITY_COLUMNS;

export const CLIENT_CAPABILITIES: readonly ClientCapability[] = [
  'viewInvoices',
  'downloadFiles',
  'comment',
  'approve',
] as const;

/** The capability flags as read from the database. */
export interface ClientCapabilityFlags {
  canViewInvoices: boolean;
  canDownloadFiles: boolean;
  canComment: boolean;
  canApprove: boolean;
}

export const LEAST_PRIVILEGE_FLAGS: ClientCapabilityFlags = {
  canViewInvoices: false,
  canDownloadFiles: false,
  canComment: false,
  canApprove: false,
};

export function hasCapability(flags: ClientCapabilityFlags, capability: ClientCapability): boolean {
  return flags[CLIENT_CAPABILITY_COLUMNS[capability]] === true;
}

/** Human-readable labels, used by the admin UI and portal navigation. */
export const CLIENT_CAPABILITY_LABELS: Record<ClientCapability, string> = {
  viewInvoices: 'View invoices and payment status',
  downloadFiles: 'Download shared files',
  comment: 'Comment on shared resources',
  approve: 'Respond to approval requests',
};

/**
 * Client roles are labels that pre-fill capability defaults in the admin UI.
 * Authorization always reads the stored flags, so changing a label never
 * silently expands access.
 */
export const CLIENT_ROLE_PRESETS: Record<string, { label: string; flags: ClientCapabilityFlags }> =
  {
    client_viewer: {
      label: 'Viewer — read shared work only',
      flags: {
        canViewInvoices: true,
        canDownloadFiles: false,
        canComment: false,
        canApprove: false,
      },
    },
    client_reviewer: {
      label: 'Reviewer — comment and download',
      flags: { canViewInvoices: true, canDownloadFiles: true, canComment: true, canApprove: false },
    },
    client_approver: {
      label: 'Approver — review, download and approve',
      flags: { canViewInvoices: true, canDownloadFiles: true, canComment: true, canApprove: true },
    },
  };

export const CLIENT_ACCESS_STATUSES = ['active', 'suspended', 'revoked'] as const;
export type ClientAccessStatus = (typeof CLIENT_ACCESS_STATUSES)[number];

export function isClientAccessUsable(status: string): boolean {
  return status === 'active';
}
