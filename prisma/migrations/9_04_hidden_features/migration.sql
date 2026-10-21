ALTER TABLE "access_control"."features" ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE "access_control"."features" SET "hidden" = TRUE WHERE "key" IN ('dashboards', 'agents');

COMMENT ON COLUMN "access_control"."features"."hidden" IS 'TRUE while the feature is withheld from every API response: the feature, its permissions and its data are left out, and saving keeps whatever was stored for it.';

UPDATE "access_control"."permissions"
   SET "feature_id" = (SELECT f."id" FROM "access_control"."features" f WHERE f."key" = 'dashboards')
 WHERE "key" = 'dashboard.assign' AND "feature_id" IS NULL;
