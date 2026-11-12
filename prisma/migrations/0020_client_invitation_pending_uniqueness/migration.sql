-- Phase 4D / Batch 4C-2: at most one live client-portal invitation per
-- organization and recipient.
--
-- `createClientInvitation` used to decide in application code ("no pending
-- invitation for this address?"), then insert. Two concurrent requests - from
-- one administrator, two administrators, or two application instances - could
-- both read "none" and both insert, producing two pending invitations with two
-- distinct usable tokens and two e-mails (see docs/phase-4d/
-- client-invitation-concurrency.md for the reproduction).
--
-- The invariant now lives in the database, so it holds for every writer:
--
--   one row with status = 'pending' per (organizationId, lower(email))
--
-- It is a PARTIAL index, which is what preserves the rest of the lifecycle:
-- revoked, expired and accepted invitations are outside the index, so a new
-- invitation can always replace them. `lower(email)` matches the application's
-- own comparison: an address is one recipient whatever its capitalisation.
--
-- Additive only: no row is inserted, updated or deleted by this migration.
--
-- ============================================
-- Pre-flight guard — report legacy duplicates, never repair them
-- ============================================
--
-- Before this batch the application could store several pending invitations for
-- one recipient. Those rows belong to real people and carry real audit history,
-- so the migration refuses to run rather than letting PostgreSQL fail halfway or
-- silently picking a winner. Nothing is changed; the offending groups are
-- printed so an operator can decide, per group, which invitation stays live.
--
-- Detect them read-only (also documented in the batch notes):
--
--   SELECT "organizationId", lower(email) AS recipient, count(*) AS pending,
--          string_agg(id, ', ' ORDER BY "createdAt") AS ids
--     FROM "ClientInvitation"
--    WHERE status = 'pending'
--    GROUP BY 1, 2
--   HAVING count(*) > 1;
--
-- Remediation is manual and non-destructive: keep the invitation the recipient
-- should use and move the surplus rows to 'expired' (their window has closed) or
-- 'revoked' (an administrator withdrew them), with the reason recorded in the
-- audit trail. Deleting them is never necessary.
--
-- Note that an expired invitation that is still marked 'pending' counts as a
-- duplicate here too, because the index cannot ask "is it still valid?" — a
-- partial index predicate must be immutable, so it may not call now(). The
-- application retires such rows to 'expired' inside the transaction that creates
-- the replacement, so a normal expired invitation never blocks a new one.

DO $$
DECLARE
  duplicate_pending TEXT;
BEGIN
  SELECT string_agg(
           format('org %s / recipient %s (%s pending rows: %s)',
                  "organizationId", recipient, pending_rows, ids),
           E'\n' ORDER BY recipient)
    INTO duplicate_pending
    FROM (
      SELECT "organizationId",
             lower(email) AS recipient,
             count(*) AS pending_rows,
             string_agg(id, ', ' ORDER BY "createdAt") AS ids
        FROM "ClientInvitation"
       WHERE status = 'pending'
       GROUP BY "organizationId", lower(email)
      HAVING count(*) > 1
       LIMIT 20
    ) duplicates;

  IF duplicate_pending IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot create ClientInvitation_pending_org_email_key: duplicate pending invitations exist.%',
      E'\n' || duplicate_pending ||
      E'\nNo data was changed. Keep one invitation per group and move the rest to'
      ' ''expired'' or ''revoked'' (never delete them), then re-run the migration.'
      ' See docs/phase-4d/client-invitation-concurrency.md.';
  END IF;
END
$$;

-- ============================================
-- One live invitation per organization + recipient
-- ============================================
--
-- Deliberately not expressible in prisma/schema.prisma (Prisma has no partial
-- indexes), so `prisma migrate deploy` is the supported path and any future
-- migration must be generated with `--create-only` and reviewed so it does not
-- drop this index. See docs/phase-4d/client-invitation-concurrency.md §3.

CREATE UNIQUE INDEX IF NOT EXISTS "ClientInvitation_pending_org_email_key"
  ON "ClientInvitation" ("organizationId", lower(email))
  WHERE status = 'pending';

-- Rollback (safe at any time; the index is additive and constrains nothing but
-- duplicate live invitations):
--   DROP INDEX IF EXISTS "ClientInvitation_pending_org_email_key";
