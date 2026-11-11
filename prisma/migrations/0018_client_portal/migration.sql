-- Phase 4C: secure client portal.
--
-- Adds a client-portal identity layer that is deliberately separate from
-- organization membership: a client login is a `User` row with
-- `userType = 'client'`, no `organizationId` and no `UserRole` rows, so the
-- existing RBAC path cannot grant it internal capabilities. Visibility is an
-- explicit allow-list (`ClientResourceGrant`); nothing is inferred from record
-- ids.
--
-- No existing table is destroyed and no historical row is rewritten. The only
-- change to an existing table is one additive column on "User", defaulted to
-- 'internal', which keeps every current member classified exactly as before.

-- ---------------------------------------------------------------------------
-- User: classify internal team members vs client-portal identities
-- ---------------------------------------------------------------------------
ALTER TABLE "User"
  ADD COLUMN "userType" TEXT NOT NULL DEFAULT 'internal';

CREATE INDEX "User_userType_idx" ON "User" ("userType");

-- ---------------------------------------------------------------------------
-- ClientAccess: one portal identity per client contact
-- ---------------------------------------------------------------------------
CREATE TABLE "ClientAccess" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "accountId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "role" TEXT NOT NULL DEFAULT 'client_viewer',
  "canViewInvoices" BOOLEAN NOT NULL DEFAULT false,
  "canDownloadFiles" BOOLEAN NOT NULL DEFAULT false,
  "canComment" BOOLEAN NOT NULL DEFAULT false,
  "canApprove" BOOLEAN NOT NULL DEFAULT false,
  "invitedBy" TEXT,
  "suspendedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "lastAccessAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientAccess_pkey" PRIMARY KEY ("id")
);

-- One portal login per user keeps session-to-tenant resolution unambiguous.
CREATE UNIQUE INDEX "ClientAccess_userId_key" ON "ClientAccess" ("userId");
CREATE UNIQUE INDEX "ClientAccess_organizationId_contactId_key"
  ON "ClientAccess" ("organizationId", "contactId");
CREATE INDEX "ClientAccess_organizationId_status_idx" ON "ClientAccess" ("organizationId", "status");

ALTER TABLE "ClientAccess"
  ADD CONSTRAINT "ClientAccess_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientAccess"
  ADD CONSTRAINT "ClientAccess_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientAccess"
  ADD CONSTRAINT "ClientAccess_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- ClientInvitation
-- ---------------------------------------------------------------------------
CREATE TABLE "ClientInvitation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "accountId" TEXT,
  "tokenHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "role" TEXT NOT NULL DEFAULT 'client_viewer',
  "canViewInvoices" BOOLEAN NOT NULL DEFAULT false,
  "canDownloadFiles" BOOLEAN NOT NULL DEFAULT false,
  "canComment" BOOLEAN NOT NULL DEFAULT false,
  "canApprove" BOOLEAN NOT NULL DEFAULT false,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "invitedBy" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "acceptedByUserId" TEXT,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientInvitation_tokenHash_key" ON "ClientInvitation" ("tokenHash");
CREATE INDEX "ClientInvitation_organizationId_email_idx"
  ON "ClientInvitation" ("organizationId", "email");
CREATE INDEX "ClientInvitation_organizationId_status_idx"
  ON "ClientInvitation" ("organizationId", "status");

ALTER TABLE "ClientInvitation"
  ADD CONSTRAINT "ClientInvitation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientInvitation"
  ADD CONSTRAINT "ClientInvitation_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientInvitation"
  ADD CONSTRAINT "ClientInvitation_invitedBy_fkey"
  FOREIGN KEY ("invitedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- ClientResourceGrant: explicit allow-list of shared resources
-- ---------------------------------------------------------------------------
CREATE TABLE "ClientResourceGrant" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientAccessId" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "canComment" BOOLEAN NOT NULL DEFAULT false,
  "canApprove" BOOLEAN NOT NULL DEFAULT false,
  "note" TEXT,
  "sharedBy" TEXT,
  "sharedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "revokedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientResourceGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientResourceGrant_clientAccessId_resourceType_resourceId_key"
  ON "ClientResourceGrant" ("clientAccessId", "resourceType", "resourceId");
CREATE INDEX "ClientResourceGrant_organizationId_resourceType_resourceId_idx"
  ON "ClientResourceGrant" ("organizationId", "resourceType", "resourceId");
CREATE INDEX "ClientResourceGrant_clientAccessId_revokedAt_idx"
  ON "ClientResourceGrant" ("clientAccessId", "revokedAt");

ALTER TABLE "ClientResourceGrant"
  ADD CONSTRAINT "ClientResourceGrant_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientResourceGrant"
  ADD CONSTRAINT "ClientResourceGrant_clientAccessId_fkey"
  FOREIGN KEY ("clientAccessId") REFERENCES "ClientAccess"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientResourceGrant"
  ADD CONSTRAINT "ClientResourceGrant_sharedBy_fkey"
  FOREIGN KEY ("sharedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- ClientApprovalRequest + append-only event history
-- ---------------------------------------------------------------------------
CREATE TABLE "ClientApproval" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientAccessId" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "dueAt" TIMESTAMP(3),
  "requestedBy" TEXT,
  "respondedBy" TEXT,
  "respondedAt" TIMESTAMP(3),
  "responseNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientApproval_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClientApproval_organizationId_status_idx"
  ON "ClientApproval" ("organizationId", "status");
CREATE INDEX "ClientApproval_clientAccessId_status_idx"
  ON "ClientApproval" ("clientAccessId", "status");
CREATE INDEX "ClientApproval_organizationId_resourceType_resourceId_idx"
  ON "ClientApproval" ("organizationId", "resourceType", "resourceId");

ALTER TABLE "ClientApproval"
  ADD CONSTRAINT "ClientApproval_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientApproval"
  ADD CONSTRAINT "ClientApproval_clientAccessId_fkey"
  FOREIGN KEY ("clientAccessId") REFERENCES "ClientAccess"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientApproval"
  ADD CONSTRAINT "ClientApproval_requestedBy_fkey"
  FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ClientApproval"
  ADD CONSTRAINT "ClientApproval_respondedBy_fkey"
  FOREIGN KEY ("respondedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ClientApprovalEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "approvalId" TEXT NOT NULL,
  "actorType" TEXT NOT NULL,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientApprovalEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClientApprovalEvent_approvalId_createdAt_idx"
  ON "ClientApprovalEvent" ("approvalId", "createdAt");

ALTER TABLE "ClientApprovalEvent"
  ADD CONSTRAINT "ClientApprovalEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientApprovalEvent"
  ADD CONSTRAINT "ClientApprovalEvent_approvalId_fkey"
  FOREIGN KEY ("approvalId") REFERENCES "ClientApproval"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientApprovalEvent"
  ADD CONSTRAINT "ClientApprovalEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- ClientComment: client-visible feedback vs internal-only notes
-- ---------------------------------------------------------------------------
CREATE TABLE "ClientComment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientAccessId" TEXT,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "authorUserId" TEXT NOT NULL,
  "authorType" TEXT NOT NULL,
  "visibility" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClientComment_organizationId_resourceType_resourceId_createdAt_idx"
  ON "ClientComment" ("organizationId", "resourceType", "resourceId", "createdAt");
CREATE INDEX "ClientComment_clientAccessId_createdAt_idx"
  ON "ClientComment" ("clientAccessId", "createdAt");

ALTER TABLE "ClientComment"
  ADD CONSTRAINT "ClientComment_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientComment"
  ADD CONSTRAINT "ClientComment_clientAccessId_fkey"
  FOREIGN KEY ("clientAccessId") REFERENCES "ClientAccess"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ClientComment"
  ADD CONSTRAINT "ClientComment_authorUserId_fkey"
  FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Portal permissions
--
-- Internal staff capabilities for administering the portal. Clients never
-- receive rows here: their capabilities are the flags on ClientAccess.
-- Existing Administrator roles are granted the new codes; custom roles keep
-- their least-privilege grants until an administrator changes them.
-- ---------------------------------------------------------------------------
INSERT INTO "Permission" ("id", "code", "description", "createdAt")
VALUES
  (gen_random_uuid()::text, 'client.access.read', 'View client portal accesses and grants', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'client.access.manage', 'Create, suspend and revoke client portal access; share or revoke resources', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'client.invitation.read', 'View client portal invitations', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'client.invitation.create', 'Invite a client into the portal', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'client.invitation.revoke', 'Revoke a pending client portal invitation', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'client.approval.read', 'View client approval requests and their history', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'client.approval.create', 'Request a client approval on a shared resource', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'client.comment.read', 'Read client feedback, including internal-only notes', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'client.comment.create', 'Write internal notes on shared client resources', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId", "grantedAt")
SELECT r."id", p."id", CURRENT_TIMESTAMP
FROM "Role" r
CROSS JOIN "Permission" p
WHERE r."isSystem" = true
  AND r."name" = 'Administrator'
  AND p."code" LIKE 'client.%'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
