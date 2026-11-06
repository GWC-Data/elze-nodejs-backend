-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "primary_admin_id" UUID;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_primary_admin_id_fkey" FOREIGN KEY ("primary_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- Backfill: each existing company's earliest-created company admin becomes its default admin
UPDATE "companies" c
SET "primary_admin_id" = (
  SELECT u."id"
    FROM "users" u
    JOIN "access_control"."user_roles" ur ON ur."user_id" = u."id"
    JOIN "access_control"."roles" r ON r."id" = ur."role_id"
   WHERE u."company_id" = c."id"
     AND r."tier"::text = 'COMPANY_ADMIN'
     AND u."deleted_at" IS NULL
   ORDER BY u."created_at", u."id"
   LIMIT 1
)
WHERE c."primary_admin_id" IS NULL;
