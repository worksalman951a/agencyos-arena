BEGIN;

CREATE UNIQUE INDEX "FeatureFlag_organizationId_flagKey_key"
  ON "FeatureFlag"("organizationId", "flagKey");
DROP INDEX "FeatureFlag_flagKey_key";

COMMIT;
