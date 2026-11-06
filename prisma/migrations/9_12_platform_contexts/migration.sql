-- AlterTable
ALTER TABLE "connections" ALTER COLUMN "company_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "context_layer_versions" ALTER COLUMN "company_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "context_profiles" ALTER COLUMN "company_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "access_control"."context_company_access" (
    "connection_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "access_level_id" UUID NOT NULL,
    "granted_by" UUID,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "context_company_access_pkey" PRIMARY KEY ("connection_id","company_id")
);

-- CreateIndex
CREATE INDEX "idx_context_company_access_company_id" ON "access_control"."context_company_access"("company_id");

-- AddForeignKey
ALTER TABLE "access_control"."context_company_access" ADD CONSTRAINT "fk_context_company_access_connection_id" FOREIGN KEY ("connection_id") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "access_control"."context_company_access" ADD CONSTRAINT "fk_context_company_access_company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "access_control"."context_company_access" ADD CONSTRAINT "fk_context_company_access_access_level_id" FOREIGN KEY ("access_level_id") REFERENCES "access_control"."access_levels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "access_control"."context_company_access" ADD CONSTRAINT "fk_context_company_access_granted_by" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;


-- Contexts created by platform accounts become platform contexts (no company).
-- A context that was open to its whole company stays open to that company as a "view" share.
INSERT INTO "access_control"."context_company_access" ("connection_id", "company_id", "access_level_id", "granted_by", "granted_at")
SELECT c."id", c."company_id", l."id", c."created_by", now()
  FROM "connections" c
  JOIN "users" u ON u."id" = c."created_by" AND u."company_id" IS NULL
  JOIN "access_control"."access_levels" l ON l."resource"::text = 'context' AND l."key" = 'view'
 WHERE c."company_id" IS NOT NULL AND c."general_access"::text = 'company';

-- Two platform contexts may not share a provider and name; a later duplicate keeps its old company's name.
UPDATE "connections" c
   SET "name" = left(c."name" || ' (' || co."name" || ')', 120)
  FROM "companies" co, "users" u
 WHERE co."id" = c."company_id" AND u."id" = c."created_by" AND u."company_id" IS NULL AND c."deleted_at" IS NULL
   AND EXISTS (
     SELECT 1
       FROM "connections" o
       JOIN "users" ou ON ou."id" = o."created_by" AND ou."company_id" IS NULL
      WHERE o."id" <> c."id" AND o."provider" = c."provider" AND o."name" = c."name"
        AND o."deleted_at" IS NULL AND o."company_id" IS NOT NULL
        AND (o."created_at", o."id") < (c."created_at", c."id")
   );

UPDATE "context_layer_versions" v
   SET "company_id" = NULL
  FROM "connections" c, "users" u
 WHERE v."connection_id" = c."id" AND u."id" = c."created_by" AND u."company_id" IS NULL;

UPDATE "context_profiles" p
   SET "company_id" = NULL
  FROM "connections" c, "users" u
 WHERE p."connection_id" = c."id" AND u."id" = c."created_by" AND u."company_id" IS NULL;

UPDATE "connections" c
   SET "company_id" = NULL, "general_access" = 'restricted'
  FROM "users" u
 WHERE u."id" = c."created_by" AND u."company_id" IS NULL AND c."company_id" IS NOT NULL;

-- Platform context names are unique per provider among live contexts.
CREATE UNIQUE INDEX "uq_platform_connections_name" ON "connections" ("provider", "name")
  WHERE "company_id" IS NULL AND "deleted_at" IS NULL;
