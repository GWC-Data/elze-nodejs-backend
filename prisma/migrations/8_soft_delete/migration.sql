ALTER TABLE "users" ADD COLUMN "deleted_at" TIMESTAMPTZ(6), ADD COLUMN "deleted_by" INTEGER;
ALTER TABLE "companies" ADD COLUMN "deleted_at" TIMESTAMPTZ(6), ADD COLUMN "deleted_by" INTEGER;
ALTER TABLE "groups" ADD COLUMN "deleted_at" TIMESTAMPTZ(6), ADD COLUMN "deleted_by" INTEGER;
ALTER TABLE "access_control"."roles" ADD COLUMN "deleted_at" TIMESTAMPTZ(6), ADD COLUMN "deleted_by" INTEGER;
ALTER TABLE "dashboards" ADD COLUMN "deleted_at" TIMESTAMPTZ(6), ADD COLUMN "deleted_by" INTEGER;
ALTER TABLE "connections" ADD COLUMN "deleted_at" TIMESTAMPTZ(6), ADD COLUMN "deleted_by" INTEGER;
ALTER TABLE "context_layer_versions" ADD COLUMN "deleted_at" TIMESTAMPTZ(6), ADD COLUMN "deleted_by" INTEGER;

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "uq_users_username";
DROP INDEX IF EXISTS "public"."uq_users_username";
CREATE UNIQUE INDEX "uq_users_username" ON "users" ("username") WHERE "deleted_at" IS NULL;

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "uq_users_email";
DROP INDEX IF EXISTS "public"."uq_users_email";
CREATE UNIQUE INDEX "uq_users_email" ON "users" ("email") WHERE "deleted_at" IS NULL;

ALTER TABLE "companies" DROP CONSTRAINT IF EXISTS "uq_companies_name";
DROP INDEX IF EXISTS "public"."uq_companies_name";
CREATE UNIQUE INDEX "uq_companies_name" ON "companies" ("name") WHERE "deleted_at" IS NULL;

ALTER TABLE "companies" DROP CONSTRAINT IF EXISTS "uq_companies_slug";
DROP INDEX IF EXISTS "public"."uq_companies_slug";
CREATE UNIQUE INDEX "uq_companies_slug" ON "companies" ("slug") WHERE "deleted_at" IS NULL;

ALTER TABLE "groups" DROP CONSTRAINT IF EXISTS "uq_groups_company_name";
DROP INDEX IF EXISTS "public"."uq_groups_company_name";
CREATE UNIQUE INDEX "uq_groups_company_name" ON "groups" ("company_id", "name") WHERE "deleted_at" IS NULL;

ALTER TABLE "access_control"."roles" DROP CONSTRAINT IF EXISTS "uq_roles_company_name";
DROP INDEX IF EXISTS "access_control"."uq_roles_company_name";
CREATE UNIQUE INDEX "uq_roles_company_name" ON "access_control"."roles" ("company_id", "name") WHERE "deleted_at" IS NULL;

ALTER TABLE "connections" DROP CONSTRAINT IF EXISTS "uq_context_connections_name";
DROP INDEX IF EXISTS "public"."uq_context_connections_name";
CREATE UNIQUE INDEX "uq_context_connections_name" ON "connections" ("company_id", "provider", "name") WHERE "deleted_at" IS NULL;

ALTER TABLE "connections" ALTER COLUMN "general_access" SET DEFAULT 'restricted';
UPDATE "connections" SET "general_access" = 'restricted' WHERE "general_access" = 'company';

CREATE OR REPLACE VIEW "access_control"."user_effective_permissions" AS
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
     LEFT JOIN "access_control"."features" f ON f.id = p.feature_id
    WHERE u.deleted_at IS NULL;

CREATE OR REPLACE VIEW "access_control"."user_resource_access" AS
   WITH company_dashboards AS (
  SELECT cd.company_id, cd.dashboard_id FROM "access_control"."company_dashboards" cd
   WHERE NOT EXISTS (SELECT 1 FROM "dashboards" x WHERE x.id = cd.dashboard_id AND x.deleted_at IS NOT NULL)
  UNION
  SELECT d.company_id, d.id FROM "dashboards" d WHERE d.company_id IS NOT NULL AND d.deleted_at IS NULL
),
   sources AS (
     SELECT pu.user_id, 'dashboard'::text AS resource_type, d.id::text AS resource_id,
            'admin'::text AS level_key, 'platform owner'::text AS via
       FROM (SELECT ur.user_id FROM "access_control"."user_roles" ur
  JOIN "access_control"."roles" r ON r.id = ur.role_id AND r.tier = 'SUPER_ADMIN') pu CROSS JOIN "dashboards" d
      WHERE d.deleted_at IS NULL
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
       JOIN "groups" g ON g.id = ga.group_id AND g.active AND g.deleted_at IS NULL
       JOIN "group_users" gu ON gu.group_id = g.id
       JOIN "users" u ON u.id = gu.user_id AND u.company_id = g.company_id
       JOIN company_dashboards cd ON cd.company_id = u.company_id AND cd.dashboard_id = ga.dashboard_id
       JOIN "access_control"."access_levels" l ON l.id = ga.access_level_id
     UNION ALL
     SELECT pu.user_id, 'context', cn.id::text, 'full', 'platform owner'
       FROM (SELECT ur.user_id FROM "access_control"."user_roles" ur
  JOIN "access_control"."roles" r ON r.id = ur.role_id AND r.tier = 'SUPER_ADMIN') pu CROSS JOIN "connections" cn
      WHERE cn.deleted_at IS NULL
     UNION ALL
     SELECT u.id, 'context', cn.id::text, 'full', 'permission context.manage_all'
       FROM "users" u JOIN "connections" cn ON cn.company_id = u.company_id AND cn.deleted_at IS NULL
      WHERE EXISTS (
  SELECT 1 FROM "access_control"."user_effective_permissions" e
   WHERE e.user_id = u.id AND e.permission_key = 'context.manage_all' AND e.is_effective)
     UNION ALL
     SELECT cn.created_by, 'context', cn.id::text, 'full', 'owner'
       FROM "connections" cn
       JOIN "users" u ON u.id = cn.created_by AND u.company_id = cn.company_id
      WHERE cn.deleted_at IS NULL
     UNION ALL
     SELECT a.user_id, 'context', a.connection_id::text, l.key, 'shared directly'
       FROM "access_control"."context_user_access" a
       JOIN "connections" cn ON cn.id = a.connection_id AND cn.deleted_at IS NULL
       JOIN "users" u ON u.id = a.user_id AND u.company_id = cn.company_id
       JOIN "access_control"."access_levels" l ON l.id = a.access_level_id
     UNION ALL
     SELECT gu.user_id, 'context', ga.connection_id::text, l.key, 'group ' || g.name
       FROM "access_control"."context_group_access" ga
       JOIN "groups" g ON g.id = ga.group_id AND g.active AND g.deleted_at IS NULL
       JOIN "group_users" gu ON gu.group_id = g.id
       JOIN "connections" cn ON cn.id = ga.connection_id AND cn.deleted_at IS NULL
       JOIN "users" u ON u.id = gu.user_id AND u.company_id = cn.company_id
       JOIN "access_control"."access_levels" l ON l.id = ga.access_level_id
   )
   SELECT s.user_id, u.username, u.email, co.name AS company_name,
          s.resource_type, s.resource_id,
          COALESCE(d.title, cn.name) AS resource_name,
          (array_agg(l.key ORDER BY l.rank DESC))[1] AS access_level,
          (array_agg(l.label ORDER BY l.rank DESC))[1] AS access_level_label,
          (array_agg(l.id ORDER BY l.rank DESC))[1] AS access_level_id,
          array_agg(DISTINCT s.via || ' (' || l.key || ')') AS granted_via
     FROM sources s
     JOIN "users" u ON u.id = s.user_id AND u.deleted_at IS NULL
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

CREATE OR REPLACE VIEW "access_control"."user_access_summary" AS
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
                     WHERE gu.user_id = u.id AND g.deleted_at IS NULL), '{}') AS groups,
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
     LEFT JOIN "access_control"."user_data_scopes" ds ON ds.user_id = u.id
    WHERE u.deleted_at IS NULL;

CREATE OR REPLACE VIEW "access_control"."role_permission_summary" AS
   SELECT r.id AS role_id, r.name AS role_name, r.kind AS role_kind, r.tier AS role_tier,
          COALESCE(c.name, 'All companies') AS company_name,
          COALESCE((SELECT array_agg(p.key ORDER BY p.sort_order)
                      FROM unnest(rp.permission_ids) AS pid JOIN "access_control"."permissions" p ON p.id = pid), '{}') AS permissions,
          COALESCE(cardinality(rp.permission_ids), 0) AS permission_count,
          (SELECT COUNT(*) FROM "access_control"."user_roles" ur
             JOIN "users" hu ON hu.id = ur.user_id AND hu.deleted_at IS NULL
            WHERE ur.role_id = r.id) AS user_count,
          rp.updated_at AS permissions_updated_at,
          (SELECT uu.username FROM "users" uu WHERE uu.id = rp.updated_by) AS permissions_updated_by
     FROM "access_control"."roles" r
     LEFT JOIN "companies" c ON c.id = r.company_id
     LEFT JOIN "access_control"."role_permissions" rp ON rp.role_id = r.id
    WHERE r.deleted_at IS NULL;

CREATE OR REPLACE VIEW "access_control"."company_feature_summary" AS
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
    WHERE c.deleted_at IS NULL
    GROUP BY c.id, c.name, cf.feature_ids, cf.updated_at, cf.updated_by;

COMMENT ON COLUMN "users"."deleted_at" IS 'When the account was deleted. Deleted rows are kept (soft delete) and hidden everywhere.';
COMMENT ON COLUMN "users"."deleted_by" IS 'public.users.id of whoever deleted the account.';
COMMENT ON COLUMN "companies"."deleted_at" IS 'When the company was deleted. Deleted rows are kept (soft delete) and hidden everywhere.';
COMMENT ON COLUMN "companies"."deleted_by" IS 'public.users.id of whoever deleted the company.';
COMMENT ON COLUMN "groups"."deleted_at" IS 'When the group was deleted. Deleted rows are kept (soft delete), hidden, and grant nothing.';
COMMENT ON COLUMN "groups"."deleted_by" IS 'public.users.id of whoever deleted the group.';
COMMENT ON COLUMN "access_control"."roles"."deleted_at" IS 'When the company role was deleted. Deleted rows are kept (soft delete) and hidden everywhere.';
COMMENT ON COLUMN "access_control"."roles"."deleted_by" IS 'public.users.id of whoever deleted the role.';
COMMENT ON COLUMN "dashboards"."deleted_at" IS 'When the dashboard was deleted. Deleted rows are kept (soft delete) and hidden everywhere.';
COMMENT ON COLUMN "dashboards"."deleted_by" IS 'public.users.id of whoever deleted the dashboard.';
COMMENT ON COLUMN "connections"."deleted_at" IS 'When the context was deleted. Deleted rows are kept (soft delete) with their versions, datasets, reviews and shares, and hidden everywhere.';
COMMENT ON COLUMN "connections"."deleted_by" IS 'public.users.id of whoever deleted the context.';
COMMENT ON COLUMN "context_layer_versions"."deleted_at" IS 'When the published version was deleted. Deleted rows are kept (soft delete) and hidden everywhere; their version numbers are not reused.';
COMMENT ON COLUMN "context_layer_versions"."deleted_by" IS 'public.users.id of whoever deleted the version.';
