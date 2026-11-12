-- Phase 4D / Batch 2: rate limiting for AgencyOS' own API routes.
--
-- Better Auth's limiter only covers /api/auth/*, and its default store is a
-- per-process Map. This table is the shared bucket store used by
-- lib/security/rate-limit.ts: one atomic INSERT ... ON CONFLICT DO UPDATE per
-- request, so two Node instances cannot each grant the same client a full
-- budget. Additive only — no existing table or row is touched.

CREATE TABLE "RateLimitBucket" (
  "key" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- Sweeping expired buckets (and auditing table growth) needs this index.
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket" ("expiresAt");
