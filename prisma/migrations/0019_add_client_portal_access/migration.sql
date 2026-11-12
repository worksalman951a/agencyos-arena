-- CreateTable ClientPortalAccess
CREATE TABLE IF NOT EXISTS "ClientPortalAccess" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "invitationHash" TEXT,
    "invitationExpiry" TIMESTAMP(3),
    "magicLinkHash" TEXT,
    "magicLinkExpiry" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "invitedBy" TEXT,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientPortalAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable ClientPortalSession
CREATE TABLE IF NOT EXISTS "ClientPortalSession" (
    "id" TEXT NOT NULL,
    "portalAccessId" TEXT NOT NULL,
    "sessionHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientPortalSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ClientPortalAccess_invitationHash_key" ON "ClientPortalAccess"("invitationHash");
CREATE UNIQUE INDEX IF NOT EXISTS "ClientPortalAccess_magicLinkHash_key" ON "ClientPortalAccess"("magicLinkHash");
CREATE UNIQUE INDEX IF NOT EXISTS "ClientPortalAccess_organizationId_contactId_key" ON "ClientPortalAccess"("organizationId", "contactId");
CREATE UNIQUE INDEX IF NOT EXISTS "ClientPortalAccess_organizationId_email_key" ON "ClientPortalAccess"("organizationId", "email");
CREATE INDEX IF NOT EXISTS "ClientPortalAccess_organizationId_status_idx" ON "ClientPortalAccess"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "ClientPortalAccess_invitationHash_idx" ON "ClientPortalAccess"("invitationHash");
CREATE INDEX IF NOT EXISTS "ClientPortalAccess_magicLinkHash_idx" ON "ClientPortalAccess"("magicLinkHash");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ClientPortalSession_sessionHash_key" ON "ClientPortalSession"("sessionHash");
CREATE INDEX IF NOT EXISTS "ClientPortalSession_portalAccessId_idx" ON "ClientPortalSession"("portalAccessId");
CREATE INDEX IF NOT EXISTS "ClientPortalSession_sessionHash_idx" ON "ClientPortalSession"("sessionHash");
CREATE INDEX IF NOT EXISTS "ClientPortalSession_expiresAt_idx" ON "ClientPortalSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "ClientPortalAccess" ADD CONSTRAINT "ClientPortalAccess_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientPortalAccess" ADD CONSTRAINT "ClientPortalAccess_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientPortalSession" ADD CONSTRAINT "ClientPortalSession_portalAccessId_fkey" FOREIGN KEY ("portalAccessId") REFERENCES "ClientPortalAccess"("id") ON DELETE CASCADE ON UPDATE CASCADE;
