-- CreateEnum
CREATE TYPE "credit_entry_kind" AS ENUM ('allocation', 'usage', 'refund');

-- CreateTable
CREATE TABLE "credit_rates" (
    "action" VARCHAR(40) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "description" TEXT,
    "credits" DECIMAL(10,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_rates_pkey" PRIMARY KEY ("action")
);

-- CreateTable
CREATE TABLE "company_credits" (
    "company_id" UUID NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_credits_pkey" PRIMARY KEY ("company_id")
);

-- CreateTable
CREATE TABLE "user_credit_limits" (
    "user_id" UUID NOT NULL,
    "monthly_credits" DECIMAL(12,2) NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_credit_limits_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "credit_ledger" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "kind" "credit_entry_kind" NOT NULL,
    "credits" DECIMAL(12,2) NOT NULL,
    "balance_after" DECIMAL(12,2) NOT NULL,
    "user_id" UUID,
    "action" VARCHAR(40),
    "context_id" UUID,
    "session_id" VARCHAR(128),
    "refund_of" UUID,
    "note" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credit_ledger_refund_of_key" ON "credit_ledger"("refund_of");

-- CreateIndex
CREATE INDEX "idx_credit_ledger_company_time" ON "credit_ledger"("company_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_credit_ledger_user_time" ON "credit_ledger"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "credit_rates" ADD CONSTRAINT "credit_rates_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "company_credits" ADD CONSTRAINT "company_credits_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_credit_limits" ADD CONSTRAINT "user_credit_limits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_credit_limits" ADD CONSTRAINT "user_credit_limits_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_refund_of_fkey" FOREIGN KEY ("refund_of") REFERENCES "credit_ledger"("id") ON DELETE CASCADE ON UPDATE NO ACTION;


ALTER TABLE "credit_rates" ADD CONSTRAINT "ck_credit_rates_credits" CHECK ("credits" >= 0);
ALTER TABLE "company_credits" ADD CONSTRAINT "ck_company_credits_balance" CHECK ("balance" >= 0);
ALTER TABLE "user_credit_limits" ADD CONSTRAINT "ck_user_credit_limits_monthly" CHECK ("monthly_credits" >= 0);

INSERT INTO "credit_rates" ("action", "label", "description", "credits", "sort_order") VALUES
  ('context.build', 'Build or refresh a context', 'Each AI run that reads the selected datasets and writes the context: a first build, a re-run, or a refresh with new or changed datasets.', 2.00, 0),
  ('context.chat', 'Understand chat message', 'Each message sent to the description editor on the Understand step.', 0.20, 1),
  ('analyst.question', 'Data analyst question', 'Each question asked to the data analyst.', 0.50, 2)
ON CONFLICT ("action") DO NOTHING;

INSERT INTO "access_control"."permissions" ("id", "key", "label", "description", "feature_id", "platform_only", "admin_only", "sort_order")
SELECT '7c611b04-1e1d-4e6a-b65e-ba1572ccc1cb', 'credits.manage', 'Manage Credits',
       'See the company''s credit usage and set how many credits each member can use a month.', NULL, FALSE, TRUE,
       COALESCE(MAX("sort_order"), 0) + 1
  FROM "access_control"."permissions"
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "access_control"."permissions" ("id", "key", "label", "description", "feature_id", "platform_only", "admin_only", "sort_order")
SELECT '21fc5e8f-dbd3-405a-8e67-cb8584c5aa29', 'credits.allocate', 'Allocate Credits',
       'Give companies credits, take credits back, and set what each AI action costs.', NULL, TRUE, FALSE,
       COALESCE(MAX("sort_order"), 0) + 1
  FROM "access_control"."permissions"
ON CONFLICT ("id") DO NOTHING;

UPDATE "access_control"."role_permissions"
   SET "permission_ids" = "permission_ids" || ARRAY['7c611b04-1e1d-4e6a-b65e-ba1572ccc1cb']::uuid[], "updated_at" = now()
 WHERE "role_id" IN ('b81ad886-d47f-4978-8bfd-e8c28d745c81', '6686f739-2e9f-4c62-8df3-eeaf69e85b5e', '301f455d-b2f0-4a7c-82db-66ed9fe2fd9d')
   AND NOT ('7c611b04-1e1d-4e6a-b65e-ba1572ccc1cb'::uuid = ANY ("permission_ids"));

UPDATE "access_control"."role_permissions"
   SET "permission_ids" = "permission_ids" || ARRAY['21fc5e8f-dbd3-405a-8e67-cb8584c5aa29']::uuid[], "updated_at" = now()
 WHERE "role_id" IN ('b81ad886-d47f-4978-8bfd-e8c28d745c81', '6686f739-2e9f-4c62-8df3-eeaf69e85b5e')
   AND NOT ('21fc5e8f-dbd3-405a-8e67-cb8584c5aa29'::uuid = ANY ("permission_ids"));

INSERT INTO "public"."audit_event_types" ("key", "label", "categories", "action", "sort_order") VALUES
  ('credits_allocated', 'credits allocated', ARRAY['company', 'credits']::text[], 'create', 57),
  ('credit_limit_updated', 'credit limit changed', ARRAY['company', 'credits']::text[], 'update', 58),
  ('credit_rate_updated', 'credit price changed', ARRAY['credits']::text[], 'update', 59)
ON CONFLICT ("key") DO NOTHING;
