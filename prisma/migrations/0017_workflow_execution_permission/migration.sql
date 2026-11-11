-- Separate manual workflow retries from rule configuration privileges.
-- Existing Administrator roles receive the capability; custom roles keep their
-- least-privilege grants and must be explicitly updated by an administrator.

INSERT INTO "Permission" ("id", "code", "description", "createdAt")
VALUES (
  gen_random_uuid()::text,
  'workflow.execute',
  'Retry failed workflow executions',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId", "grantedAt")
SELECT r."id", p."id", CURRENT_TIMESTAMP
FROM "Role" r
CROSS JOIN "Permission" p
WHERE r."isSystem" = true
  AND r."name" = 'Administrator'
  AND p."code" = 'workflow.execute'
ON CONFLICT DO NOTHING;
