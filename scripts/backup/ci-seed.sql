-- Fixture for the `backup-verify` CI job.
--
-- The backup/restore test needs *real* rows to prove it, but it must not depend
-- on the application fixtures used by the integration suite (those bring in a
-- seeded organization and a long chain of related records which would have to
-- be re-created here, and would then break whenever a CRM fixture changed).
--
-- This seeds the smallest graph that still exercises the parts of the restore
-- that can silently go wrong:
--
--   Organization ─┬─ User ── Session
--                 └─ Role
--
-- A parent row plus children across three tables means the verifier proves
-- foreign keys survived (the FK constraints are validated against real data,
-- not an empty table), that dependent rows arrived with their parent, and that
-- timestamps/JSONB/enums round-tripped. The `backup-verify` job then asserts
-- these exact identifiers and row counts inside the restored database.
--
-- Idempotent so re-running the job locally against a dev DB is harmless (it
-- writes only the four fixed ids below). Every value here is synthetic; no
-- production data and no secret is involved.

BEGIN;

INSERT INTO "Organization" ("id", "name", "slug", "domain", "settings", "createdAt", "updatedAt")
VALUES (
  'bkverify-org-0001',
  'Backup Verify Organization',
  'backup-verify-org',
  'example.test',
  '{"plan":"verification","features":["backup","restore"]}'::jsonb,
  '2026-01-01 00:00:00',
  '2026-01-01 00:00:00'
)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Role" ("id", "name", "description", "organizationId", "isSystem", "createdAt", "updatedAt")
VALUES (
  'bkverify-role-0001',
  'Backup Verify Role',
  'Role used to prove role rows survive a restore',
  'bkverify-org-0001',
  false,
  '2026-01-01 00:00:00',
  '2026-01-01 00:00:00'
)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "User" (
  "id", "email", "emailVerified", "name", "password",
  "createdAt", "updatedAt", "organizationId", "role", "status", "userType"
)
VALUES (
  'bkverify-user-0001',
  'backup-verify@example.test',
  -- BOOLEAN since migration 0003 (it started life as a timestamp); an INSERT
  -- with a timestamp literal here is what made the first CI run fail.
  true,
  'Backup Verify User',
  NULL,
  '2026-01-01 00:00:00',
  '2026-01-01 00:00:00',
  'bkverify-org-0001',
  'admin',
  'active',
  'internal'
)
ON CONFLICT ("id") DO NOTHING;

-- A child of User: a session row must move with its user, and a broken FK here
-- is exactly the kind of half-restore the verifier is meant to catch.
INSERT INTO "Session" ("id", "token", "userId", "expiresAt", "createdAt", "updatedAt")
VALUES (
  'bkverify-session-0001',
  'bkverify-session-token-0001',
  'bkverify-user-0001',
  '2030-01-01 00:00:00',
  '2026-01-01 00:00:00',
  '2026-01-01 00:00:00'
)
ON CONFLICT ("id") DO NOTHING;

-- Two rate-limit rows: proves a table added by a recent migration (0019) is
-- present in the archive rather than only in the migration history.
INSERT INTO "RateLimitBucket" ("key", "count", "windowStart", "expiresAt", "updatedAt")
VALUES
  ('bkverify:bucket:one', 3, '2026-01-01 00:00:00', '2030-01-01 00:00:00', '2026-01-01 00:00:00'),
  ('bkverify:bucket:two', 7, '2026-01-01 00:00:00', '2030-01-01 00:00:00', '2026-01-01 00:00:00')
ON CONFLICT ("key") DO NOTHING;

COMMIT;
