-- Keep at most one live internal-team invitation per organization and email.
-- The application pre-check gives a friendly error; this partial unique index
-- is the database invariant that closes concurrent-request races.

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
        FROM "Invitation"
       WHERE status = 'pending'
       GROUP BY "organizationId", lower(email)
      HAVING count(*) > 1
       LIMIT 20
    ) duplicates;

  IF duplicate_pending IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot create Invitation_pending_org_email_key: duplicate pending team invitations exist.%',
      E'\n' || duplicate_pending ||
      E'\nNo data was changed. Keep one invitation per group and mark the rest'
      ' as ''revoked'' or ''expired'', then re-run this migration.';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "Invitation_pending_org_email_key"
  ON "Invitation" ("organizationId", lower(email))
  WHERE status = 'pending';

-- Rollback: DROP INDEX IF EXISTS "Invitation_pending_org_email_key";
