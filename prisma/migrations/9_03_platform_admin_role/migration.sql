INSERT INTO "access_control"."roles" ("id", "company_id", "kind", "tier", "name", "description") VALUES
  ('6686f739-2e9f-4c62-8df3-eeaf69e85b5e', NULL, 'system', 'PLATFORM_ADMIN', 'Platform admin',
   'Platform administrator created by the platform owner. Manages companies and their accounts; cannot see or manage platform accounts.')
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "access_control"."role_permissions" ("role_id", "permission_ids")
SELECT '6686f739-2e9f-4c62-8df3-eeaf69e85b5e'::uuid,
       ARRAY(SELECT p."id" FROM "access_control"."permissions" p WHERE p."key" <> 'role.update' ORDER BY p."sort_order")
ON CONFLICT ("role_id") DO NOTHING;

CREATE OR REPLACE FUNCTION "access_control"."check_user_role"() RETURNS trigger AS $$
   DECLARE
     role_row RECORD;
     user_company INTEGER;
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

UPDATE "access_control"."user_roles" ur
   SET "role_id" = '6686f739-2e9f-4c62-8df3-eeaf69e85b5e', "assigned_at" = now()
 WHERE ur."role_id" = 'b81ad886-d47f-4978-8bfd-e8c28d745c81'
   AND ur."user_id" <> (SELECT o."user_id"
                          FROM "access_control"."user_roles" o
                          JOIN "users" u ON u."id" = o."user_id"
                         WHERE o."role_id" = 'b81ad886-d47f-4978-8bfd-e8c28d745c81'
                         ORDER BY (u."deleted_at" IS NOT NULL), u."created_at", u."id"
                         LIMIT 1);

CREATE UNIQUE INDEX "uq_user_roles_one_platform_owner" ON "access_control"."user_roles" ((TRUE))
  WHERE "role_id" = 'b81ad886-d47f-4978-8bfd-e8c28d745c81';

CREATE OR REPLACE VIEW "access_control"."user_resource_access" AS
   WITH company_dashboards AS (
  SELECT cd.company_id, cd.dashboard_id FROM "access_control"."company_dashboards" cd
   WHERE NOT EXISTS (SELECT 1 FROM "dashboards" x WHERE x.id = cd.dashboard_id AND x.deleted_at IS NOT NULL)
  UNION
  SELECT d.company_id, d.id FROM "dashboards" d WHERE d.company_id IS NOT NULL AND d.deleted_at IS NULL
),
   sources AS (
     SELECT pu.user_id, 'dashboard'::text AS resource_type, d.id::text AS resource_id,
            'admin'::text AS level_key, lower(pu.role_name)::text AS via
       FROM (SELECT ur.user_id, r.name AS role_name FROM "access_control"."user_roles" ur
  JOIN "access_control"."roles" r ON r.id = ur.role_id AND r.kind = 'system' AND r.tier IN ('SUPER_ADMIN', 'PLATFORM_ADMIN')) pu CROSS JOIN "dashboards" d
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
     SELECT pu.user_id, 'context', cn.id::text, 'full', lower(pu.role_name)
       FROM (SELECT ur.user_id, r.name AS role_name FROM "access_control"."user_roles" ur
  JOIN "access_control"."roles" r ON r.id = ur.role_id AND r.kind = 'system' AND r.tier IN ('SUPER_ADMIN', 'PLATFORM_ADMIN')) pu CROSS JOIN "connections" cn
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

COMMENT ON INDEX "access_control"."uq_user_roles_one_platform_owner" IS 'There is exactly one platform owner (SUPER_ADMIN); other platform accounts are platform admins.';
