-- Phase 3A Batch 4: automation execution guards, notification preferences
-- and dedupe, and organization membership invitations.

-- ---------------------------------------------------------------------------
-- WorkflowExecution: idempotency + retry bookkeeping
-- ---------------------------------------------------------------------------
ALTER TABLE "WorkflowExecution"
  ADD COLUMN "dedupeKey" TEXT,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- One execution per (rule, record, dedupe key). NULL keys do not collide in
-- PostgreSQL, so executions recorded without a guard keep working.
CREATE UNIQUE INDEX "WorkflowExecution_ruleId_recordType_recordId_dedupeKey_key"
  ON "WorkflowExecution" ("ruleId", "recordType", "recordId", "dedupeKey");

CREATE INDEX "WorkflowExecution_organizationId_createdAt_idx"
  ON "WorkflowExecution" ("organizationId", "createdAt");

ALTER TABLE "WorkflowExecution"
  ADD CONSTRAINT "WorkflowExecution_ruleId_fkey"
  FOREIGN KEY ("ruleId") REFERENCES "WorkflowRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Notification: timestamp + duplicate-notification guard
-- ---------------------------------------------------------------------------
ALTER TABLE "Notification"
  ADD COLUMN "dedupeKey" TEXT,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "Notification_organizationId_userId_type_dedupeKey_key"
  ON "Notification" ("organizationId", "userId", "type", "dedupeKey");

CREATE INDEX "Notification_organizationId_userId_read_idx"
  ON "Notification" ("organizationId", "userId", "read");

-- ---------------------------------------------------------------------------
-- NotificationPreference
-- ---------------------------------------------------------------------------
CREATE TABLE "NotificationPreference" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "channels" JSONB NOT NULL DEFAULT '{}',
  "mutedTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationPreference_organizationId_userId_key"
  ON "NotificationPreference" ("organizationId", "userId");

ALTER TABLE "NotificationPreference"
  ADD CONSTRAINT "NotificationPreference_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationPreference"
  ADD CONSTRAINT "NotificationPreference_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Invitation
-- ---------------------------------------------------------------------------
CREATE TABLE "Invitation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "invitedBy" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "acceptedBy" TEXT,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation" ("tokenHash");
CREATE INDEX "Invitation_organizationId_email_idx" ON "Invitation" ("organizationId", "email");
CREATE INDEX "Invitation_organizationId_status_idx" ON "Invitation" ("organizationId", "status");

ALTER TABLE "Invitation"
  ADD CONSTRAINT "Invitation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invitation"
  ADD CONSTRAINT "Invitation_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invitation"
  ADD CONSTRAINT "Invitation_invitedBy_fkey"
  FOREIGN KEY ("invitedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Permissions used by the new administration surfaces
-- ---------------------------------------------------------------------------
INSERT INTO "Permission" ("id", "code", "description", "createdAt")
VALUES
  (gen_random_uuid()::text, 'workflow.create', 'Create automation workflow rules', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'invitation.read', 'View organization invitations', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'invitation.create', 'Invite members to the organization', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'invitation.revoke', 'Revoke organization invitations', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'notification.preference', 'Manage own notification preferences', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Existing Administrator roles get the new codes. Custom roles do not: least
-- privilege means a new capability is never granted implicitly.
INSERT INTO "RolePermission" ("roleId", "permissionId", "grantedAt")
SELECT r."id", p."id", CURRENT_TIMESTAMP
FROM "Role" r
CROSS JOIN "Permission" p
WHERE r."isSystem" = true
  AND r."name" = 'Administrator'
  AND p."code" IN ('workflow.create', 'invitation.read', 'invitation.create', 'invitation.revoke', 'notification.preference')
ON CONFLICT DO NOTHING;
