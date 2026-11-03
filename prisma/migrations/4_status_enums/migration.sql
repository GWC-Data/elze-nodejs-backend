DROP VIEW IF EXISTS "access_control"."company_feature_summary" CASCADE;

DROP VIEW IF EXISTS "access_control"."role_permission_summary" CASCADE;

DROP VIEW IF EXISTS "access_control"."user_access_summary" CASCADE;

DROP VIEW IF EXISTS "access_control"."user_resource_access" CASCADE;

DROP VIEW IF EXISTS "access_control"."user_effective_permissions" CASCADE;

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS chk_users_status;
ALTER TABLE "connections" DROP CONSTRAINT IF EXISTS chk_context_connections_general_access;
ALTER TABLE "context_layer_versions" DROP CONSTRAINT IF EXISTS chk_context_version_status;
ALTER TABLE "context_layer_versions" DROP CONSTRAINT IF EXISTS chk_context_version_published;
ALTER TABLE "context_object_reviews" DROP CONSTRAINT IF EXISTS chk_context_review_status;
ALTER TABLE "connectors" DROP CONSTRAINT IF EXISTS chk_connectors_status;
ALTER TABLE "audit_event_types" DROP CONSTRAINT IF EXISTS chk_audit_event_types_action;
ALTER TABLE "access_control"."access_levels" DROP CONSTRAINT IF EXISTS chk_access_levels_resource;
ALTER TABLE "access_control"."roles" DROP CONSTRAINT IF EXISTS chk_roles_kind;
ALTER TABLE "access_control"."roles" DROP CONSTRAINT IF EXISTS chk_roles_tier;
ALTER TABLE "access_control"."roles" DROP CONSTRAINT IF EXISTS chk_roles_company;
ALTER TABLE "access_control"."roles" DROP CONSTRAINT IF EXISTS chk_roles_company_tier;

DROP INDEX IF EXISTS "access_control"."uq_roles_system_tier";
DROP INDEX IF EXISTS "access_control"."uq_roles_company_default";
DROP INDEX IF EXISTS "uq_context_layer_one_draft";

CREATE TYPE "user_status" AS ENUM ('pending', 'active', 'disabled');
CREATE TYPE "connection_status" AS ENUM ('connected', 'invalid');
CREATE TYPE "general_access" AS ENUM ('restricted', 'company');
CREATE TYPE "version_status" AS ENUM ('draft', 'published');
CREATE TYPE "context_step" AS ENUM ('connect', 'context', 'discover', 'profile', 'understand', 'model', 'review', 'publish');
CREATE TYPE "review_status" AS ENUM ('pending', 'approved', 'rejected', 'skipped');
CREATE TYPE "connector_status" AS ENUM ('available', 'planned');
CREATE TYPE "audit_action" AS ENUM ('create', 'update', 'delete');
CREATE TYPE "access_control"."role_kind" AS ENUM ('system', 'company_default', 'custom');
CREATE TYPE "access_control"."role_tier" AS ENUM ('SUPER_ADMIN', 'COMPANY_ADMIN', 'USER');
CREATE TYPE "access_control"."access_resource" AS ENUM ('dashboard', 'context');

ALTER TABLE "users" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "status" TYPE "user_status" USING "status"::text::"user_status";
ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'pending';
ALTER TABLE "connections" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "connections" ALTER COLUMN "status" TYPE "connection_status" USING "status"::text::"connection_status";
ALTER TABLE "connections" ALTER COLUMN "status" SET DEFAULT 'connected';
ALTER TABLE "connections" ALTER COLUMN "general_access" DROP DEFAULT;
ALTER TABLE "connections" ALTER COLUMN "general_access" TYPE "general_access" USING "general_access"::text::"general_access";
ALTER TABLE "connections" ALTER COLUMN "general_access" SET DEFAULT 'company';
ALTER TABLE "context_layer_versions" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "context_layer_versions" ALTER COLUMN "status" TYPE "version_status" USING "status"::text::"version_status";
ALTER TABLE "context_layer_versions" ALTER COLUMN "status" SET DEFAULT 'draft';
ALTER TABLE "context_layer_versions" ALTER COLUMN "current_step" TYPE "context_step" USING "current_step"::text::"context_step";
ALTER TABLE "context_object_reviews" ALTER COLUMN "status" TYPE "review_status" USING "status"::text::"review_status";
ALTER TABLE "connectors" ALTER COLUMN "status" TYPE "connector_status" USING "status"::text::"connector_status";
ALTER TABLE "audit_event_types" ALTER COLUMN "action" TYPE "audit_action" USING "action"::text::"audit_action";
ALTER TABLE "access_control"."roles" ALTER COLUMN "kind" TYPE "access_control"."role_kind" USING "kind"::text::"access_control"."role_kind";
ALTER TABLE "access_control"."roles" ALTER COLUMN "tier" TYPE "access_control"."role_tier" USING "tier"::text::"access_control"."role_tier";
ALTER TABLE "access_control"."access_levels" ALTER COLUMN "resource" TYPE "access_control"."access_resource" USING "resource"::text::"access_control"."access_resource";

ALTER TABLE "context_layer_versions" ADD CONSTRAINT chk_context_version_published CHECK (status <> 'published' OR published_at IS NOT NULL);
ALTER TABLE "access_control"."roles" ADD CONSTRAINT chk_roles_company CHECK ((kind = 'system') = (company_id IS NULL));
ALTER TABLE "access_control"."roles" ADD CONSTRAINT chk_roles_company_tier CHECK (kind = 'system' OR tier = 'USER');

CREATE UNIQUE INDEX uq_roles_system_tier ON "access_control"."roles" (tier) WHERE kind = 'system';
CREATE UNIQUE INDEX uq_roles_company_default ON "access_control"."roles" (company_id, tier) WHERE kind = 'company_default';
CREATE UNIQUE INDEX uq_context_layer_one_draft ON "context_layer_versions" (connection_id) WHERE status = 'draft';

CREATE OR REPLACE FUNCTION "access_control"."check_access_level"() RETURNS trigger AS $$
   BEGIN
     IF NOT EXISTS (SELECT 1 FROM "access_control"."access_levels" l WHERE l.id = NEW.access_level_id AND l.resource::text = TG_ARGV[0]) THEN
       RAISE EXCEPTION 'access level % is not a % access level', NEW.access_level_id, TG_ARGV[0]
         USING ERRCODE = 'check_violation';
     END IF;
     RETURN NEW;
   END $$ LANGUAGE plpgsql;

CREATE VIEW "access_control"."user_effective_permissions" AS
   SELECT u.id AS user_id, u.username, u.email, u.company_id, c.name AS company_name,
          r.id AS role_id, r.name AS role_name, r.tier AS role_tier,
          p.id AS permission_id, p.key AS permission_key, p.label AS permission_label,
          f.key AS feature_key,
          held.via_role, held.via_user_grant,
          (u.company_id IS NULL OR p.feature_id IS NULL OR COALESCE(f.locked, FALSE)
            OR p.feature_id = ANY(COALESCE(cf.feature_ids, '{}'::uuid[]))) AS is_effective
     FROM "users" u
     LEFT JOIN "companies" c ON c.id = u.company_id
     LEFT JOIN "access_control"."user_roles" ur ON ur.user_id = u.id
     LEFT JOIN "access_control"."roles" r ON r.id = ur.role_id
     LEFT JOIN "access_control"."company_features" cf ON cf.company_id = u.company_id
     CROSS JOIN LATERAL (
       SELECT src.permission_id,
              bool_or(src.source = 'role') AS via_role,
              bool_or(src.source = 'user_grant') AS via_user_grant
         FROM (
           SELECT unnest(rp.permission_ids) AS permission_id, 'role' AS source
             FROM "access_control"."role_permissions" rp WHERE rp.role_id = r.id
           UNION ALL
           SELECT unnest(up.permission_ids), 'user_grant'
             FROM "access_control"."user_permissions" up WHERE up.user_id = u.id
         ) src
        GROUP BY src.permission_id
     ) held
     JOIN "access_control"."permissions" p ON p.id = held.permission_id
     LEFT JOIN "access_control"."features" f ON f.id = p.feature_id;

CREATE VIEW "access_control"."user_resource_access" AS
   WITH company_dashboards AS (
  SELECT cd.company_id, cd.dashboard_id FROM "access_control"."company_dashboards" cd
  UNION
  SELECT d.company_id, d.id FROM "dashboards" d WHERE d.company_id IS NOT NULL
),
   sources AS (
     SELECT pu.user_id, 'dashboard'::text AS resource_type, d.id::text AS resource_id,
            'admin'::text AS level_key, 'platform owner'::text AS via
       FROM (SELECT ur.user_id FROM "access_control"."user_roles" ur
  JOIN "access_control"."roles" r ON r.id = ur.role_id AND r.tier = 'SUPER_ADMIN') pu CROSS JOIN "dashboards" d
     UNION ALL
     SELECT u.id, 'dashboard', cd.dashboard_id, 'admin', 'permission access.grant'
       FROM "users" u JOIN company_dashboards cd ON cd.company_id = u.company_id
      WHERE EXISTS (
  SELECT 1 FROM "access_control"."user_effective_permissions" e
   WHERE e.user_id = u.id AND e.permission_key = 'access.grant' AND e.is_effective)
     UNION ALL
     SELECT a.user_id, 'dashboard', a.dashboard_id, l.key, 'shared directly'
       FROM "access_control"."dashboard_user_access" a
       JOIN "users" u ON u.id = a.user_id
       JOIN company_dashboards cd ON cd.company_id = u.company_id AND cd.dashboard_id = a.dashboard_id
       JOIN "access_control"."access_levels" l ON l.id = a.access_level_id
     UNION ALL
     SELECT gu.user_id, 'dashboard', ga.dashboard_id, l.key, 'group ' || g.name
       FROM "access_control"."dashboard_group_access" ga
       JOIN "groups" g ON g.id = ga.group_id AND g.active
       JOIN "group_users" gu ON gu.group_id = g.id
       JOIN "users" u ON u.id = gu.user_id AND u.company_id = g.company_id
       JOIN company_dashboards cd ON cd.company_id = u.company_id AND cd.dashboard_id = ga.dashboard_id
       JOIN "access_control"."access_levels" l ON l.id = ga.access_level_id
     UNION ALL
     SELECT pu.user_id, 'context', cn.id::text, 'full', 'platform owner'
       FROM (SELECT ur.user_id FROM "access_control"."user_roles" ur
  JOIN "access_control"."roles" r ON r.id = ur.role_id AND r.tier = 'SUPER_ADMIN') pu CROSS JOIN "connections" cn
     UNION ALL
     SELECT u.id, 'context', cn.id::text, 'full', 'permission context.manage_all'
       FROM "users" u JOIN "connections" cn ON cn.company_id = u.company_id
      WHERE EXISTS (
  SELECT 1 FROM "access_control"."user_effective_permissions" e
   WHERE e.user_id = u.id AND e.permission_key = 'context.manage_all' AND e.is_effective)
     UNION ALL
     SELECT cn.created_by, 'context', cn.id::text, 'full', 'owner'
       FROM "connections" cn
       JOIN "users" u ON u.id = cn.created_by AND u.company_id = cn.company_id
     UNION ALL
     SELECT a.user_id, 'context', a.connection_id::text, l.key, 'shared directly'
       FROM "access_control"."context_user_access" a
       JOIN "connections" cn ON cn.id = a.connection_id
       JOIN "users" u ON u.id = a.user_id AND u.company_id = cn.company_id
       JOIN "access_control"."access_levels" l ON l.id = a.access_level_id
     UNION ALL
     SELECT gu.user_id, 'context', ga.connection_id::text, l.key, 'group ' || g.name
       FROM "access_control"."context_group_access" ga
       JOIN "groups" g ON g.id = ga.group_id AND g.active
       JOIN "group_users" gu ON gu.group_id = g.id
       JOIN "connections" cn ON cn.id = ga.connection_id
       JOIN "users" u ON u.id = gu.user_id AND u.company_id = cn.company_id
       JOIN "access_control"."access_levels" l ON l.id = ga.access_level_id
     UNION ALL
     SELECT u.id, 'context', cn.id::text, 'view', 'everyone in the company'
       FROM "connections" cn JOIN "users" u ON u.company_id = cn.company_id
      WHERE cn.general_access = 'company'
   )
   SELECT s.user_id, u.username, u.email, co.name AS company_name,
          s.resource_type, s.resource_id,
          COALESCE(d.title, cn.name) AS resource_name,
          (array_agg(l.key ORDER BY l.rank DESC))[1] AS access_level,
          (array_agg(l.label ORDER BY l.rank DESC))[1] AS access_level_label,
          (array_agg(l.id ORDER BY l.rank DESC))[1] AS access_level_id,
          array_agg(DISTINCT s.via || ' (' || l.key || ')') AS granted_via
     FROM sources s
     JOIN "users" u ON u.id = s.user_id
     LEFT JOIN "companies" co ON co.id = u.company_id
     JOIN "access_control"."access_levels" l ON l.resource::text = s.resource_type AND l.key = s.level_key
     LEFT JOIN "dashboards" d ON s.resource_type = 'dashboard' AND d.id = s.resource_id
     LEFT JOIN "connections" cn ON s.resource_type = 'context' AND cn.id::text = s.resource_id
    WHERE (s.resource_type = 'dashboard' AND EXISTS (
  SELECT 1 FROM "access_control"."user_effective_permissions" e
   WHERE e.user_id = s.user_id AND e.permission_key = 'dashboard.read' AND e.is_effective))
       OR (s.resource_type = 'context' AND EXISTS (
  SELECT 1 FROM "access_control"."user_effective_permissions" e
   WHERE e.user_id = s.user_id AND e.permission_key = 'context.read' AND e.is_effective))
    GROUP BY s.user_id, u.username, u.email, co.name, s.resource_type, s.resource_id, d.title, cn.name;

CREATE VIEW "access_control"."user_access_summary" AS
   SELECT u.id AS user_id, u.username, u.email, u.display_name, u.status,
          c.name AS company_name,
          r.name AS role_name, r.tier AS role_tier, r.kind AS role_kind,
          COALESCE((SELECT array_agg(e.permission_key ORDER BY e.permission_key)
                      FROM "access_control"."user_effective_permissions" e
                     WHERE e.user_id = u.id AND e.is_effective), '{}') AS permissions,
          COALESCE((SELECT array_agg(p.key ORDER BY p.key)
                      FROM "access_control"."user_permissions" up
                      CROSS JOIN LATERAL unnest(up.permission_ids) AS pid
                      JOIN "access_control"."permissions" p ON p.id = pid
                     WHERE up.user_id = u.id), '{}') AS extra_permissions,
          COALESCE((SELECT array_agg(f.key ORDER BY f.sort_order)
                      FROM "access_control"."features" f
                     WHERE u.company_id IS NULL OR f.locked
                        OR f.id = ANY(COALESCE(cf.feature_ids, '{}'::uuid[]))), '{}') AS features,
          COALESCE((SELECT array_agg(g.name ORDER BY g.name)
                      FROM "group_users" gu JOIN "groups" g ON g.id = gu.group_id
                     WHERE gu.user_id = u.id), '{}') AS groups,
          COALESCE((SELECT array_agg(ra.resource_name || ': ' || ra.access_level_label ORDER BY ra.resource_name)
                      FROM "access_control"."user_resource_access" ra
                     WHERE ra.user_id = u.id AND ra.resource_type = 'dashboard'), '{}') AS dashboards,
          COALESCE((SELECT array_agg(ra.resource_name || ': ' || ra.access_level_label ORDER BY ra.resource_name)
                      FROM "access_control"."user_resource_access" ra
                     WHERE ra.user_id = u.id AND ra.resource_type = 'context'), '{}') AS contexts,
          COALESCE(ds.scopes, '{}'::jsonb) AS data_scopes
     FROM "users" u
     LEFT JOIN "companies" c ON c.id = u.company_id
     LEFT JOIN "access_control"."user_roles" ur ON ur.user_id = u.id
     LEFT JOIN "access_control"."roles" r ON r.id = ur.role_id
     LEFT JOIN "access_control"."company_features" cf ON cf.company_id = u.company_id
     LEFT JOIN "access_control"."user_data_scopes" ds ON ds.user_id = u.id;

CREATE VIEW "access_control"."role_permission_summary" AS
   SELECT r.id AS role_id, r.name AS role_name, r.kind AS role_kind, r.tier AS role_tier,
          COALESCE(c.name, 'All companies') AS company_name,
          COALESCE((SELECT array_agg(p.key ORDER BY p.sort_order)
                      FROM unnest(rp.permission_ids) AS pid JOIN "access_control"."permissions" p ON p.id = pid), '{}') AS permissions,
          COALESCE(cardinality(rp.permission_ids), 0) AS permission_count,
          (SELECT COUNT(*) FROM "access_control"."user_roles" ur WHERE ur.role_id = r.id) AS user_count,
          rp.updated_at AS permissions_updated_at,
          (SELECT uu.username FROM "users" uu WHERE uu.id = rp.updated_by) AS permissions_updated_by
     FROM "access_control"."roles" r
     LEFT JOIN "companies" c ON c.id = r.company_id
     LEFT JOIN "access_control"."role_permissions" rp ON rp.role_id = r.id;

CREATE VIEW "access_control"."company_feature_summary" AS
   SELECT c.id AS company_id, c.name AS company_name,
          COALESCE(array_agg(f.key ORDER BY f.sort_order)
                     FILTER (WHERE f.locked OR f.id = ANY(COALESCE(cf.feature_ids, '{}'::uuid[]))), '{}') AS enabled_features,
          COALESCE(array_agg(f.key ORDER BY f.sort_order)
                     FILTER (WHERE NOT f.locked AND NOT f.id = ANY(COALESCE(cf.feature_ids, '{}'::uuid[]))), '{}') AS disabled_features,
          COALESCE(array_agg(f.key ORDER BY f.sort_order) FILTER (WHERE f.locked), '{}') AS locked_features,
          cf.updated_at,
          (SELECT uu.username FROM "users" uu WHERE uu.id = cf.updated_by) AS updated_by
     FROM "companies" c
     LEFT JOIN "access_control"."company_features" cf ON cf.company_id = c.id
     CROSS JOIN "access_control"."features" f
    GROUP BY c.id, c.name, cf.feature_ids, cf.updated_at, cf.updated_by;

COMMENT ON VIEW "access_control"."user_effective_permissions" IS 'Every permission each person holds and where it comes from. The application loads permissions from this view.';

COMMENT ON COLUMN "access_control"."user_effective_permissions"."user_id" IS 'public.users.id.';

COMMENT ON COLUMN "access_control"."user_effective_permissions"."username" IS 'public.users.username.';

COMMENT ON COLUMN "access_control"."user_effective_permissions"."email" IS 'public.users.email.';

COMMENT ON COLUMN "access_control"."user_effective_permissions"."company_id" IS 'public.companies.id.';

COMMENT ON COLUMN "access_control"."user_effective_permissions"."company_name" IS 'public.companies.name.';

COMMENT ON COLUMN "access_control"."user_effective_permissions"."role_id" IS 'access_control.roles.id.';

COMMENT ON COLUMN "access_control"."user_effective_permissions"."role_name" IS 'access_control.roles.name.';

COMMENT ON COLUMN "access_control"."user_effective_permissions"."role_tier" IS 'access_control.roles.tier.';

COMMENT ON COLUMN "access_control"."user_effective_permissions"."permission_id" IS 'access_control.permissions.id.';

COMMENT ON COLUMN "access_control"."user_effective_permissions"."permission_key" IS 'access_control.permissions.key.';

COMMENT ON COLUMN "access_control"."user_effective_permissions"."permission_label" IS 'access_control.permissions.label.';

COMMENT ON COLUMN "access_control"."user_effective_permissions"."feature_key" IS 'access_control.features.key the permission belongs to.';

COMMENT ON COLUMN "access_control"."user_effective_permissions"."via_role" IS 'TRUE when the person role gives this permission.';

COMMENT ON COLUMN "access_control"."user_effective_permissions"."via_user_grant" IS 'TRUE when it was given to the person directly.';

COMMENT ON COLUMN "access_control"."user_effective_permissions"."is_effective" IS 'FALSE when the company has the feature of this permission switched off.';

COMMENT ON VIEW "access_control"."user_resource_access" IS 'Every dashboard and context each person can open, with the strongest level and how they got it. A person needs dashboard.read or context.read to open anything at all.';

COMMENT ON COLUMN "access_control"."user_resource_access"."user_id" IS 'public.users.id.';

COMMENT ON COLUMN "access_control"."user_resource_access"."username" IS 'public.users.username.';

COMMENT ON COLUMN "access_control"."user_resource_access"."email" IS 'public.users.email.';

COMMENT ON COLUMN "access_control"."user_resource_access"."company_name" IS 'public.companies.name.';

COMMENT ON COLUMN "access_control"."user_resource_access"."resource_type" IS 'dashboard or context.';

COMMENT ON COLUMN "access_control"."user_resource_access"."resource_id" IS 'public.dashboards.id or public.connections.id.';

COMMENT ON COLUMN "access_control"."user_resource_access"."resource_name" IS 'Dashboard title or context name.';

COMMENT ON COLUMN "access_control"."user_resource_access"."access_level" IS 'Strongest level the person holds on this item.';

COMMENT ON COLUMN "access_control"."user_resource_access"."access_level_label" IS 'access_control.access_levels.label of the strongest level.';

COMMENT ON COLUMN "access_control"."user_resource_access"."access_level_id" IS 'access_control.access_levels.id.';

COMMENT ON COLUMN "access_control"."user_resource_access"."granted_via" IS 'Every reason the person can open it, with the level each reason gives.';

COMMENT ON VIEW "access_control"."user_access_summary" IS 'One row per person: role, permissions, features, groups, dashboards, contexts and data scopes.';

COMMENT ON COLUMN "access_control"."user_access_summary"."user_id" IS 'public.users.id.';

COMMENT ON COLUMN "access_control"."user_access_summary"."username" IS 'public.users.username.';

COMMENT ON COLUMN "access_control"."user_access_summary"."email" IS 'public.users.email.';

COMMENT ON COLUMN "access_control"."user_access_summary"."display_name" IS 'public.users.display_name.';

COMMENT ON COLUMN "access_control"."user_access_summary"."status" IS 'public.users.status: pending, active or disabled.';

COMMENT ON COLUMN "access_control"."user_access_summary"."company_name" IS 'public.companies.name.';

COMMENT ON COLUMN "access_control"."user_access_summary"."role_name" IS 'access_control.roles.name.';

COMMENT ON COLUMN "access_control"."user_access_summary"."role_tier" IS 'access_control.roles.tier.';

COMMENT ON COLUMN "access_control"."user_access_summary"."role_kind" IS 'access_control.roles.kind.';

COMMENT ON COLUMN "access_control"."user_access_summary"."permissions" IS 'Permission keys, written out.';

COMMENT ON VIEW "access_control"."role_permission_summary" IS 'One row per role with its permissions written out and how many people hold it.';

COMMENT ON COLUMN "access_control"."role_permission_summary"."role_id" IS 'access_control.roles.id.';

COMMENT ON COLUMN "access_control"."role_permission_summary"."role_name" IS 'access_control.roles.name.';

COMMENT ON COLUMN "access_control"."role_permission_summary"."role_kind" IS 'access_control.roles.kind.';

COMMENT ON COLUMN "access_control"."role_permission_summary"."role_tier" IS 'access_control.roles.tier.';

COMMENT ON COLUMN "access_control"."role_permission_summary"."company_name" IS 'public.companies.name.';

COMMENT ON COLUMN "access_control"."role_permission_summary"."permissions" IS 'Permission keys, written out.';

COMMENT ON COLUMN "access_control"."role_permission_summary"."permission_count" IS 'Number of permissions.';

COMMENT ON COLUMN "access_control"."role_permission_summary"."user_count" IS 'Number of people holding this role.';

COMMENT ON VIEW "access_control"."company_feature_summary" IS 'One row per company with the features it has on and off.';

COMMENT ON COLUMN "access_control"."company_feature_summary"."company_id" IS 'public.companies.id.';

COMMENT ON COLUMN "access_control"."company_feature_summary"."company_name" IS 'public.companies.name.';

COMMENT ON COLUMN "access_control"."company_feature_summary"."updated_at" IS 'When it was last changed.';

COMMENT ON COLUMN "access_control"."company_feature_summary"."updated_by" IS 'public.users.id of who last changed it.';
