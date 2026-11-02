ALTER TABLE "user_credit_limits" RENAME COLUMN "monthly_credits" TO "credit_limit";
ALTER TABLE "user_credit_limits" RENAME CONSTRAINT "ck_user_credit_limits_monthly" TO "ck_user_credit_limits_limit";

UPDATE "access_control"."permissions"
   SET "description" = 'See the company''s credit usage and restrict how many credits a member can use.', "updated_at" = now()
 WHERE "id" = '7c611b04-1e1d-4e6a-b65e-ba1572ccc1cb';
