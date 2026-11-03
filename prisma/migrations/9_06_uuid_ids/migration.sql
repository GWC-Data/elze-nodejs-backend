CREATE TEMP TABLE "uuid_ids" (
  "kind" TEXT NOT NULL,
  "old_id" INTEGER NOT NULL,
  "new_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  PRIMARY KEY ("kind", "old_id")
);

INSERT INTO "uuid_ids" ("kind", "old_id") SELECT 'company', "id" FROM "companies";
INSERT INTO "uuid_ids" ("kind", "old_id") SELECT 'user', "id" FROM "users";
INSERT INTO "uuid_ids" ("kind", "old_id") SELECT 'group', "id" FROM "groups";

CREATE FUNCTION pg_temp.uuid_of("kind" TEXT, "old" INTEGER) RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT m."new_id" FROM "uuid_ids" m WHERE m."kind" = $1 AND m."old_id" = $2
$$;

CREATE FUNCTION pg_temp.uuid_json("kind" TEXT, "value" JSONB) RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT CASE
           WHEN jsonb_typeof($2) = 'number' AND ($2 #>> '{}') ~ '^[0-9]{1,9}$'
             THEN COALESCE(to_jsonb(pg_temp.uuid_of($1, ($2 #>> '{}')::INTEGER)), 'null'::JSONB)
           ELSE $2
         END
$$;

CREATE TEMP TABLE "uuid_saved_views" AS
SELECT v."position", v."name", pg_get_viewdef(format('"access_control".%I', v."name")::regclass) AS "definition"
  FROM (VALUES (1, 'user_effective_permissions'),
               (2, 'user_resource_access'),
               (3, 'user_access_summary'),
               (4, 'role_permission_summary'),
               (5, 'company_feature_summary')) AS v("position", "name");

CREATE TEMP TABLE "uuid_saved_view_comments" AS
SELECT c."relname" AS "view", a."attname" AS "column", d."description"
  FROM pg_description d
  JOIN pg_class c ON c."oid" = d."objoid" AND d."classoid" = 'pg_class'::regclass
  LEFT JOIN pg_attribute a ON d."objsubid" > 0 AND a."attrelid" = c."oid" AND a."attnum" = d."objsubid"
 WHERE c."relnamespace" = 'access_control'::regnamespace
   AND c."relname" IN (SELECT "name" FROM "uuid_saved_views");

CREATE TEMP TABLE "uuid_saved_foreign_keys" AS
SELECT con."conrelid"::regclass AS "relation", con."conname" AS "name", pg_get_constraintdef(con."oid") AS "definition",
       con."connamespace"::regnamespace::text IN ('public', 'access_control') AS "restore"
  FROM pg_constraint con
 WHERE con."contype" = 'f'
   AND con."confrelid" IN ('"companies"'::regclass, '"users"'::regclass, '"groups"'::regclass);

DROP VIEW "access_control"."user_access_summary";
DROP VIEW "access_control"."user_resource_access";
DROP VIEW "access_control"."role_permission_summary";
DROP VIEW "access_control"."company_feature_summary";
DROP VIEW "access_control"."user_effective_permissions";

DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN SELECT * FROM "uuid_saved_foreign_keys" LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk."relation", fk."name");
  END LOOP;
END $$;

ALTER TABLE "companies" ALTER COLUMN "id" DROP IDENTITY IF EXISTS;
ALTER TABLE "users" ALTER COLUMN "id" DROP IDENTITY IF EXISTS;
ALTER TABLE "groups" ALTER COLUMN "id" DROP IDENTITY IF EXISTS;
ALTER TABLE "companies" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "groups" ALTER COLUMN "id" DROP DEFAULT;
DROP SEQUENCE IF EXISTS "companies_id_seq";
DROP SEQUENCE IF EXISTS "users_id_seq";
DROP SEQUENCE IF EXISTS "groups_id_seq";

ALTER TABLE "companies"
  ALTER COLUMN "id" TYPE UUID USING pg_temp.uuid_of('company', "id"),
  ALTER COLUMN "created_by" TYPE UUID USING pg_temp.uuid_of('user', "created_by"),
  ALTER COLUMN "deleted_by" TYPE UUID USING pg_temp.uuid_of('user', "deleted_by");

ALTER TABLE "users"
  ALTER COLUMN "id" TYPE UUID USING pg_temp.uuid_of('user', "id"),
  ALTER COLUMN "company_id" TYPE UUID USING pg_temp.uuid_of('company', "company_id"),
  ALTER COLUMN "deleted_by" TYPE UUID USING pg_temp.uuid_of('user', "deleted_by");

ALTER TABLE "groups"
  ALTER COLUMN "id" TYPE UUID USING pg_temp.uuid_of('group', "id"),
  ALTER COLUMN "company_id" TYPE UUID USING pg_temp.uuid_of('company', "company_id"),
  ALTER COLUMN "creator_id" TYPE UUID USING pg_temp.uuid_of('user', "creator_id"),
  ALTER COLUMN "deleted_by" TYPE UUID USING pg_temp.uuid_of('user', "deleted_by");

ALTER TABLE "companies" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "users" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "groups" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "group_users"
  ALTER COLUMN "group_id" TYPE UUID USING pg_temp.uuid_of('group', "group_id"),
  ALTER COLUMN "user_id" TYPE UUID USING pg_temp.uuid_of('user', "user_id");

ALTER TABLE "dashboards"
  ALTER COLUMN "company_id" TYPE UUID USING pg_temp.uuid_of('company', "company_id"),
  ALTER COLUMN "created_by" TYPE UUID USING pg_temp.uuid_of('user', "created_by"),
  ALTER COLUMN "deleted_by" TYPE UUID USING pg_temp.uuid_of('user', "deleted_by");

ALTER TABLE "refresh_tokens"
  ALTER COLUMN "user_id" TYPE UUID USING pg_temp.uuid_of('user', "user_id");

ALTER TABLE "user_tokens"
  ALTER COLUMN "user_id" TYPE UUID USING pg_temp.uuid_of('user', "user_id"),
  ALTER COLUMN "created_by" TYPE UUID USING pg_temp.uuid_of('user', "created_by");

ALTER TABLE "connections"
  ALTER COLUMN "company_id" TYPE UUID USING pg_temp.uuid_of('company', "company_id"),
  ALTER COLUMN "created_by" TYPE UUID USING pg_temp.uuid_of('user', "created_by"),
  ALTER COLUMN "deleted_by" TYPE UUID USING pg_temp.uuid_of('user', "deleted_by");

ALTER TABLE "datasets"
  ALTER COLUMN "selected_by" TYPE UUID USING pg_temp.uuid_of('user', "selected_by");

ALTER TABLE "context_layer_versions"
  ALTER COLUMN "company_id" TYPE UUID USING pg_temp.uuid_of('company', "company_id"),
  ALTER COLUMN "created_by" TYPE UUID USING pg_temp.uuid_of('user', "created_by"),
  ALTER COLUMN "published_by" TYPE UUID USING pg_temp.uuid_of('user', "published_by"),
  ALTER COLUMN "deleted_by" TYPE UUID USING pg_temp.uuid_of('user', "deleted_by");

ALTER TABLE "context_object_reviews"
  ALTER COLUMN "reviewed_by" TYPE UUID USING pg_temp.uuid_of('user', "reviewed_by");

ALTER TABLE "context_profiles"
  ALTER COLUMN "company_id" TYPE UUID USING pg_temp.uuid_of('company', "company_id"),
  ALTER COLUMN "created_by" TYPE UUID USING pg_temp.uuid_of('user', "created_by");

ALTER TABLE "audit_logs"
  ALTER COLUMN "actor_id" TYPE UUID USING pg_temp.uuid_of('user', "actor_id"),
  ALTER COLUMN "actor_company_id" TYPE UUID USING pg_temp.uuid_of('company', "actor_company_id"),
  ALTER COLUMN "company_id" TYPE UUID USING pg_temp.uuid_of('company', "company_id"),
  ALTER COLUMN "target_user_id" TYPE UUID USING pg_temp.uuid_of('user', "target_user_id");

ALTER TABLE "access_control"."roles"
  ALTER COLUMN "company_id" TYPE UUID USING pg_temp.uuid_of('company', "company_id"),
  ALTER COLUMN "created_by" TYPE UUID USING pg_temp.uuid_of('user', "created_by"),
  ALTER COLUMN "modified_by" TYPE UUID USING pg_temp.uuid_of('user', "modified_by"),
  ALTER COLUMN "deleted_by" TYPE UUID USING pg_temp.uuid_of('user', "deleted_by");

ALTER TABLE "access_control"."role_permissions"
  ALTER COLUMN "updated_by" TYPE UUID USING pg_temp.uuid_of('user', "updated_by");

ALTER TABLE "access_control"."company_features"
  ALTER COLUMN "company_id" TYPE UUID USING pg_temp.uuid_of('company', "company_id"),
  ALTER COLUMN "updated_by" TYPE UUID USING pg_temp.uuid_of('user', "updated_by");

ALTER TABLE "access_control"."user_roles"
  ALTER COLUMN "user_id" TYPE UUID USING pg_temp.uuid_of('user', "user_id"),
  ALTER COLUMN "assigned_by" TYPE UUID USING pg_temp.uuid_of('user', "assigned_by");

ALTER TABLE "access_control"."user_permissions"
  ALTER COLUMN "user_id" TYPE UUID USING pg_temp.uuid_of('user', "user_id"),
  ALTER COLUMN "updated_by" TYPE UUID USING pg_temp.uuid_of('user', "updated_by");

ALTER TABLE "access_control"."user_data_scopes"
  ALTER COLUMN "user_id" TYPE UUID USING pg_temp.uuid_of('user', "user_id"),
  ALTER COLUMN "updated_by" TYPE UUID USING pg_temp.uuid_of('user', "updated_by");

ALTER TABLE "access_control"."company_dashboards"
  ALTER COLUMN "company_id" TYPE UUID USING pg_temp.uuid_of('company', "company_id"),
  ALTER COLUMN "assigned_by" TYPE UUID USING pg_temp.uuid_of('user', "assigned_by");

ALTER TABLE "access_control"."dashboard_user_access"
  ALTER COLUMN "user_id" TYPE UUID USING pg_temp.uuid_of('user', "user_id"),
  ALTER COLUMN "granted_by" TYPE UUID USING pg_temp.uuid_of('user', "granted_by");

ALTER TABLE "access_control"."dashboard_group_access"
  ALTER COLUMN "group_id" TYPE UUID USING pg_temp.uuid_of('group', "group_id"),
  ALTER COLUMN "granted_by" TYPE UUID USING pg_temp.uuid_of('user', "granted_by");

ALTER TABLE "access_control"."context_user_access"
  ALTER COLUMN "user_id" TYPE UUID USING pg_temp.uuid_of('user', "user_id"),
  ALTER COLUMN "granted_by" TYPE UUID USING pg_temp.uuid_of('user', "granted_by");

ALTER TABLE "access_control"."context_group_access"
  ALTER COLUMN "group_id" TYPE UUID USING pg_temp.uuid_of('group', "group_id"),
  ALTER COLUMN "granted_by" TYPE UUID USING pg_temp.uuid_of('user', "granted_by");

UPDATE "audit_logs"
   SET "detail" = "detail"
     || CASE WHEN "detail" ? 'userId' THEN jsonb_build_object('userId', pg_temp.uuid_json('user', "detail" -> 'userId')) ELSE '{}'::JSONB END
     || CASE WHEN "detail" ? 'groupId' THEN jsonb_build_object('groupId', pg_temp.uuid_json('group', "detail" -> 'groupId')) ELSE '{}'::JSONB END
     || CASE WHEN "detail" ? 'companyId' THEN jsonb_build_object('companyId', pg_temp.uuid_json('company', "detail" -> 'companyId')) ELSE '{}'::JSONB END
 WHERE "detail" ?| ARRAY['userId', 'groupId', 'companyId'];

UPDATE "dashboards"
   SET "spec" = jsonb_set("spec", '{companyId}', pg_temp.uuid_json('company', "spec" -> 'companyId'))
 WHERE jsonb_typeof("spec" -> 'companyId') = 'number';

CREATE OR REPLACE FUNCTION "access_control"."check_user_role"() RETURNS trigger AS $$
   DECLARE
     role_row RECORD;
     user_company UUID;
   BEGIN
     SELECT company_id, kind, tier INTO role_row FROM "access_control"."roles" WHERE id = NEW.role_id;
     SELECT company_id INTO user_company FROM "users" WHERE id = NEW.user_id;
     IF role_row.kind <> 'system' AND role_row.company_id IS DISTINCT FROM user_company THEN
       RAISE EXCEPTION 'role % belongs to another company than user %', NEW.role_id, NEW.user_id
         USING ERRCODE = 'check_violation';
     END IF;
     IF (role_row.tier IN ('SUPER_ADMIN', 'PLATFORM_ADMIN')) <> (user_company IS NULL) THEN
       RAISE EXCEPTION 'only a platform account (no company) holds SUPER_ADMIN or PLATFORM_ADMIN, and it holds nothing else'
         USING ERRCODE = 'check_violation';
     END IF;
     RETURN NEW;
   END $$ LANGUAGE plpgsql;

DO $$
DECLARE
  saved RECORD;
BEGIN
  FOR saved IN SELECT * FROM "uuid_saved_foreign_keys" WHERE "restore" LOOP
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', saved."relation", saved."name", saved."definition");
  END LOOP;
  FOR saved IN SELECT * FROM "uuid_saved_views" ORDER BY "position" LOOP
    EXECUTE format('CREATE VIEW "access_control".%I AS %s', saved."name", saved."definition");
  END LOOP;
  FOR saved IN SELECT * FROM "uuid_saved_view_comments" LOOP
    IF saved."column" IS NULL THEN
      EXECUTE format('COMMENT ON VIEW "access_control".%I IS %L', saved."view", saved."description");
    ELSE
      EXECUTE format('COMMENT ON COLUMN "access_control".%I.%I IS %L', saved."view", saved."column", saved."description");
    END IF;
  END LOOP;
END $$;

DROP FUNCTION pg_temp.uuid_json(TEXT, JSONB);
DROP FUNCTION pg_temp.uuid_of(TEXT, INTEGER);
DROP TABLE "uuid_ids", "uuid_saved_views", "uuid_saved_view_comments", "uuid_saved_foreign_keys";
