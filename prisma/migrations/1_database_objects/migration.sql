
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_status' AND conrelid = 'public.users'::regclass) THEN
    ALTER TABLE public.users ADD CONSTRAINT chk_users_status CHECK (status IN ('pending','active','disabled'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_context_connections_general_access' AND conrelid = 'public.connections'::regclass) THEN
    ALTER TABLE public.connections ADD CONSTRAINT chk_context_connections_general_access CHECK (general_access IN ('restricted','company'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_context_version_status' AND conrelid = 'public.context_layer_versions'::regclass) THEN
    ALTER TABLE public.context_layer_versions ADD CONSTRAINT chk_context_version_status CHECK (status IN ('draft','published'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_context_version_published' AND conrelid = 'public.context_layer_versions'::regclass) THEN
    ALTER TABLE public.context_layer_versions ADD CONSTRAINT chk_context_version_published CHECK (status <> 'published' OR published_at IS NOT NULL);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_context_review_status' AND conrelid = 'public.context_object_reviews'::regclass) THEN
    ALTER TABLE public.context_object_reviews ADD CONSTRAINT chk_context_review_status CHECK (status IN ('pending','approved','rejected','skipped'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_access_levels_resource' AND conrelid = 'access_control.access_levels'::regclass) THEN
    ALTER TABLE access_control.access_levels ADD CONSTRAINT chk_access_levels_resource CHECK (resource IN ('dashboard','context'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_roles_kind' AND conrelid = 'access_control.roles'::regclass) THEN
    ALTER TABLE access_control.roles ADD CONSTRAINT chk_roles_kind CHECK (kind IN ('system','company_default','custom'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_roles_tier' AND conrelid = 'access_control.roles'::regclass) THEN
    ALTER TABLE access_control.roles ADD CONSTRAINT chk_roles_tier CHECK (tier IN ('SUPER_ADMIN','COMPANY_ADMIN','USER'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_roles_company' AND conrelid = 'access_control.roles'::regclass) THEN
    ALTER TABLE access_control.roles ADD CONSTRAINT chk_roles_company CHECK ((kind = 'system') = (company_id IS NULL));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_roles_company_tier' AND conrelid = 'access_control.roles'::regclass) THEN
    ALTER TABLE access_control.roles ADD CONSTRAINT chk_roles_company_tier CHECK (kind = 'system' OR tier = 'USER');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_data_scopes_object' AND conrelid = 'access_control.user_data_scopes'::regclass) THEN
    ALTER TABLE access_control.user_data_scopes ADD CONSTRAINT chk_user_data_scopes_object CHECK (jsonb_typeof(scopes) = 'object');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'connections_company_id_fkey' AND conrelid = 'public.connections'::regclass) THEN
    ALTER TABLE public.connections ADD CONSTRAINT connections_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies (id) ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'connections_created_by_fkey' AND conrelid = 'public.connections'::regclass) THEN
    ALTER TABLE public.connections ADD CONSTRAINT connections_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users (id) ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'datasets_selected_by_fkey' AND conrelid = 'public.datasets'::regclass) THEN
    ALTER TABLE public.datasets ADD CONSTRAINT datasets_selected_by_fkey FOREIGN KEY (selected_by) REFERENCES public.users (id) ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_system_tier ON access_control.roles (tier) WHERE kind = 'system';

CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_company_default ON access_control.roles (company_id, tier) WHERE kind = 'company_default';

CREATE UNIQUE INDEX IF NOT EXISTS uq_context_layer_one_draft ON public.context_layer_versions (connection_id) WHERE status = 'draft';

CREATE OR REPLACE FUNCTION "access_control"."check_permission_ids"() RETURNS trigger AS $$
   DECLARE
     unknown_ids UUID[];
     restricted  TEXT[];
     company_held BOOLEAN;
   BEGIN
     SELECT array_agg(p) INTO unknown_ids
       FROM unnest(COALESCE(NEW.permission_ids, '{}')) AS p
      WHERE p IS NULL OR NOT EXISTS (SELECT 1 FROM "access_control"."permissions" x WHERE x.id = p);
     IF unknown_ids IS NOT NULL THEN
       RAISE EXCEPTION 'unknown permission id(s): %', unknown_ids USING ERRCODE = 'foreign_key_violation';
     END IF;

     IF TG_TABLE_NAME = 'role_permissions' THEN
       SELECT r.kind <> 'system' INTO company_held FROM "access_control"."roles" r WHERE r.id = NEW.role_id;
     ELSE
       company_held := TRUE;
     END IF;

     IF company_held THEN
       SELECT array_agg(x.key ORDER BY x.sort_order) INTO restricted
         FROM "access_control"."permissions" x
        WHERE x.id = ANY(NEW.permission_ids) AND (x.platform_only OR x.admin_only);
       IF restricted IS NOT NULL THEN
         RAISE EXCEPTION 'permission(s) % can only be held by a built-in administrator role', restricted
           USING ERRCODE = 'check_violation';
       END IF;
     END IF;

     NEW.permission_ids := ARRAY(
       SELECT x.id FROM "access_control"."permissions" x WHERE x.id = ANY(NEW.permission_ids) ORDER BY x.sort_order, x.key
     );
     RETURN NEW;
   END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_role_permissions_check ON "access_control"."role_permissions";

CREATE TRIGGER trg_role_permissions_check BEFORE INSERT OR UPDATE ON "access_control"."role_permissions" FOR EACH ROW EXECUTE FUNCTION "access_control"."check_permission_ids"();

DROP TRIGGER IF EXISTS trg_user_permissions_check ON "access_control"."user_permissions";

CREATE TRIGGER trg_user_permissions_check BEFORE INSERT OR UPDATE ON "access_control"."user_permissions" FOR EACH ROW EXECUTE FUNCTION "access_control"."check_permission_ids"();

CREATE OR REPLACE FUNCTION "access_control"."check_feature_ids"() RETURNS trigger AS $$
   DECLARE
     unknown_ids UUID[];
   BEGIN
     SELECT array_agg(f) INTO unknown_ids
       FROM unnest(COALESCE(NEW.feature_ids, '{}')) AS f
      WHERE f IS NULL OR NOT EXISTS (SELECT 1 FROM "access_control"."features" x WHERE x.id = f);
     IF unknown_ids IS NOT NULL THEN
       RAISE EXCEPTION 'unknown feature id(s): %', unknown_ids USING ERRCODE = 'foreign_key_violation';
     END IF;
     NEW.feature_ids := ARRAY(
       SELECT x.id FROM "access_control"."features" x WHERE x.id = ANY(NEW.feature_ids) ORDER BY x.sort_order, x.key
     );
     RETURN NEW;
   END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_company_features_check ON "access_control"."company_features";

CREATE TRIGGER trg_company_features_check BEFORE INSERT OR UPDATE ON "access_control"."company_features" FOR EACH ROW EXECUTE FUNCTION "access_control"."check_feature_ids"();

CREATE OR REPLACE FUNCTION "access_control"."forget_permission"() RETURNS trigger AS $$
   BEGIN
     UPDATE "access_control"."role_permissions" SET permission_ids = array_remove(permission_ids, OLD.id), updated_at = now()
      WHERE OLD.id = ANY(permission_ids);
     UPDATE "access_control"."user_permissions" SET permission_ids = array_remove(permission_ids, OLD.id), updated_at = now()
      WHERE OLD.id = ANY(permission_ids);
     RETURN OLD;
   END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_permissions_forget ON "access_control"."permissions";

CREATE TRIGGER trg_permissions_forget AFTER DELETE ON "access_control"."permissions" FOR EACH ROW EXECUTE FUNCTION "access_control"."forget_permission"();

CREATE OR REPLACE FUNCTION "access_control"."forget_feature"() RETURNS trigger AS $$
   BEGIN
     UPDATE "access_control"."company_features" SET feature_ids = array_remove(feature_ids, OLD.id), updated_at = now()
      WHERE OLD.id = ANY(feature_ids);
     RETURN OLD;
   END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_features_forget ON "access_control"."features";

CREATE TRIGGER trg_features_forget AFTER DELETE ON "access_control"."features" FOR EACH ROW EXECUTE FUNCTION "access_control"."forget_feature"();

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
     IF (role_row.tier = 'SUPER_ADMIN') <> (user_company IS NULL) THEN
       RAISE EXCEPTION 'only a platform account (no company) holds SUPER_ADMIN, and it holds nothing else'
         USING ERRCODE = 'check_violation';
     END IF;
     RETURN NEW;
   END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_roles_check ON "access_control"."user_roles";

CREATE TRIGGER trg_user_roles_check BEFORE INSERT OR UPDATE ON "access_control"."user_roles" FOR EACH ROW EXECUTE FUNCTION "access_control"."check_user_role"();

CREATE OR REPLACE FUNCTION "access_control"."check_access_level"() RETURNS trigger AS $$
   BEGIN
     IF NOT EXISTS (SELECT 1 FROM "access_control"."access_levels" l WHERE l.id = NEW.access_level_id AND l.resource = TG_ARGV[0]) THEN
       RAISE EXCEPTION 'access level % is not a % access level', NEW.access_level_id, TG_ARGV[0]
         USING ERRCODE = 'check_violation';
     END IF;
     RETURN NEW;
   END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dashboard_user_access_level ON "access_control"."dashboard_user_access";

CREATE TRIGGER trg_dashboard_user_access_level BEFORE INSERT OR UPDATE ON "access_control"."dashboard_user_access" FOR EACH ROW EXECUTE FUNCTION "access_control"."check_access_level"('dashboard');

DROP TRIGGER IF EXISTS trg_dashboard_group_access_level ON "access_control"."dashboard_group_access";

CREATE TRIGGER trg_dashboard_group_access_level BEFORE INSERT OR UPDATE ON "access_control"."dashboard_group_access" FOR EACH ROW EXECUTE FUNCTION "access_control"."check_access_level"('dashboard');

DROP TRIGGER IF EXISTS trg_context_user_access_level ON "access_control"."context_user_access";

CREATE TRIGGER trg_context_user_access_level BEFORE INSERT OR UPDATE ON "access_control"."context_user_access" FOR EACH ROW EXECUTE FUNCTION "access_control"."check_access_level"('context');

DROP TRIGGER IF EXISTS trg_context_group_access_level ON "access_control"."context_group_access";

CREATE TRIGGER trg_context_group_access_level BEFORE INSERT OR UPDATE ON "access_control"."context_group_access" FOR EACH ROW EXECUTE FUNCTION "access_control"."check_access_level"('context');

DROP VIEW IF EXISTS "access_control"."company_feature_summary" CASCADE;

DROP VIEW IF EXISTS "access_control"."role_permission_summary" CASCADE;

DROP VIEW IF EXISTS "access_control"."user_access_summary" CASCADE;

DROP VIEW IF EXISTS "access_control"."user_resource_access" CASCADE;

DROP VIEW IF EXISTS "access_control"."user_effective_permissions" CASCADE;

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
     JOIN "access_control"."access_levels" l ON l.resource = s.resource_type AND l.key = s.level_key
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

COMMENT ON SCHEMA "access_control" IS 'Who can do what: features, permissions, roles, and what each person and company has been given.';

COMMENT ON TABLE "access_control"."features" IS 'Product features a company can have switched on. One row per feature.';

COMMENT ON COLUMN "access_control"."features"."id" IS 'Fixed UUID of the feature, identical in every environment.';

COMMENT ON COLUMN "access_control"."features"."key" IS 'Readable code used by the application, e.g. dashboards.';

COMMENT ON COLUMN "access_control"."features"."label" IS 'Name shown to people.';

COMMENT ON COLUMN "access_control"."features"."description" IS 'What it is for.';

COMMENT ON COLUMN "access_control"."features"."locked" IS 'TRUE when every company always has this feature.';

COMMENT ON COLUMN "access_control"."features"."covers" IS 'Screens of the application this feature unlocks.';

COMMENT ON COLUMN "access_control"."features"."sort_order" IS 'Display order.';

COMMENT ON COLUMN "access_control"."features"."created_at" IS 'When it was created.';

COMMENT ON COLUMN "access_control"."features"."updated_at" IS 'When it was last changed.';

COMMENT ON TABLE "access_control"."permissions" IS 'Every action a role or a person can be allowed to do. One row per permission.';

COMMENT ON COLUMN "access_control"."permissions"."id" IS 'Fixed UUID of the permission, identical in every environment.';

COMMENT ON COLUMN "access_control"."permissions"."key" IS 'Readable code checked by the application, e.g. dashboard.read.';

COMMENT ON COLUMN "access_control"."permissions"."label" IS 'Name shown to people.';

COMMENT ON COLUMN "access_control"."permissions"."description" IS 'What it is for.';

COMMENT ON COLUMN "access_control"."permissions"."feature_id" IS 'access_control.features.id this permission belongs to. NULL = always available.';

COMMENT ON COLUMN "access_control"."permissions"."platform_only" IS 'TRUE when only the platform owner can hold it.';

COMMENT ON COLUMN "access_control"."permissions"."admin_only" IS 'TRUE when only the built-in company admin role can hold it.';

COMMENT ON COLUMN "access_control"."permissions"."sort_order" IS 'Display order.';

COMMENT ON COLUMN "access_control"."permissions"."defaults_applied_at" IS 'When the built-in roles were given this permission by default.';

COMMENT ON COLUMN "access_control"."permissions"."created_at" IS 'When it was created.';

COMMENT ON COLUMN "access_control"."permissions"."updated_at" IS 'When it was last changed.';

COMMENT ON TABLE "access_control"."access_levels" IS 'Levels of access a person or group can be given on one dashboard or context.';

COMMENT ON COLUMN "access_control"."access_levels"."id" IS 'UUID primary key.';

COMMENT ON COLUMN "access_control"."access_levels"."resource" IS 'dashboard or context.';

COMMENT ON COLUMN "access_control"."access_levels"."key" IS 'Readable code, e.g. view, share, edit, full.';

COMMENT ON COLUMN "access_control"."access_levels"."rank" IS 'Higher rank includes everything a lower rank allows.';

COMMENT ON COLUMN "access_control"."access_levels"."label" IS 'Name shown to people.';

COMMENT ON COLUMN "access_control"."access_levels"."description" IS 'What it is for.';

COMMENT ON TABLE "access_control"."roles" IS 'Roles. Built-in roles have no company; a company has its own Member role and its custom roles.';

COMMENT ON COLUMN "access_control"."roles"."id" IS 'UUID primary key.';

COMMENT ON COLUMN "access_control"."roles"."company_id" IS 'public.companies.id. NULL for the built-in platform-wide roles.';

COMMENT ON COLUMN "access_control"."roles"."kind" IS 'system = built-in for every company, company_default = the company own Member role, custom = made by the company.';

COMMENT ON COLUMN "access_control"."roles"."tier" IS 'SUPER_ADMIN, COMPANY_ADMIN or USER. Decides what the role may manage.';

COMMENT ON COLUMN "access_control"."roles"."name" IS 'Name shown to people.';

COMMENT ON COLUMN "access_control"."roles"."description" IS 'What it is for.';

COMMENT ON COLUMN "access_control"."roles"."created_by" IS 'public.users.id of who created it.';

COMMENT ON COLUMN "access_control"."roles"."created_at" IS 'When it was created.';

COMMENT ON COLUMN "access_control"."roles"."updated_at" IS 'When it was last changed.';

COMMENT ON COLUMN "access_control"."roles"."modified_by" IS 'public.users.id of who changed it away from the defaults.';

COMMENT ON COLUMN "access_control"."roles"."modified_at" IS 'Set when a company changed its Member role away from the built-in defaults.';

COMMENT ON TABLE "access_control"."role_permissions" IS 'The permissions of each role. One row per role.';

COMMENT ON COLUMN "access_control"."role_permissions"."role_id" IS 'access_control.roles.id.';

COMMENT ON COLUMN "access_control"."role_permissions"."permission_ids" IS 'UUIDs from access_control.permissions.id. Readable form: access_control.role_permission_summary.';

COMMENT ON COLUMN "access_control"."role_permissions"."updated_by" IS 'public.users.id of who last changed it.';

COMMENT ON COLUMN "access_control"."role_permissions"."updated_at" IS 'When it was last changed.';

COMMENT ON TABLE "access_control"."company_features" IS 'The features each company has switched on. One row per company. Locked features are always on.';

COMMENT ON COLUMN "access_control"."company_features"."company_id" IS 'public.companies.id.';

COMMENT ON COLUMN "access_control"."company_features"."feature_ids" IS 'UUIDs from access_control.features.id. Readable form: access_control.company_feature_summary.';

COMMENT ON COLUMN "access_control"."company_features"."updated_by" IS 'public.users.id of who last changed it.';

COMMENT ON COLUMN "access_control"."company_features"."updated_at" IS 'When it was last changed.';

COMMENT ON TABLE "access_control"."user_roles" IS 'The role of each person. One row per user.';

COMMENT ON COLUMN "access_control"."user_roles"."user_id" IS 'public.users.id.';

COMMENT ON COLUMN "access_control"."user_roles"."role_id" IS 'access_control.roles.id.';

COMMENT ON COLUMN "access_control"."user_roles"."assigned_by" IS 'public.users.id of who assigned it.';

COMMENT ON COLUMN "access_control"."user_roles"."assigned_at" IS 'When it was assigned.';

COMMENT ON TABLE "access_control"."user_permissions" IS 'Extra permissions given to one person on top of their role. One row per user.';

COMMENT ON COLUMN "access_control"."user_permissions"."user_id" IS 'public.users.id.';

COMMENT ON COLUMN "access_control"."user_permissions"."permission_ids" IS 'UUIDs from access_control.permissions.id. Readable form: access_control.user_access_summary.extra_permissions.';

COMMENT ON COLUMN "access_control"."user_permissions"."updated_by" IS 'public.users.id of who last changed it.';

COMMENT ON COLUMN "access_control"."user_permissions"."updated_at" IS 'When it was last changed.';

COMMENT ON TABLE "access_control"."user_data_scopes" IS 'Row-level data scopes of each person. One row per user.';

COMMENT ON COLUMN "access_control"."user_data_scopes"."user_id" IS 'public.users.id.';

COMMENT ON COLUMN "access_control"."user_data_scopes"."scopes" IS 'Object of dimension name to the list of values the person may see, e.g. {"region": ["EU"]}.';

COMMENT ON COLUMN "access_control"."user_data_scopes"."updated_by" IS 'public.users.id of who last changed it.';

COMMENT ON COLUMN "access_control"."user_data_scopes"."updated_at" IS 'When it was last changed.';

COMMENT ON TABLE "access_control"."company_dashboards" IS 'Dashboards the platform made available to a company. One row per company and dashboard.';

COMMENT ON COLUMN "access_control"."company_dashboards"."company_id" IS 'public.companies.id.';

COMMENT ON COLUMN "access_control"."company_dashboards"."dashboard_id" IS 'public.dashboards.id.';

COMMENT ON COLUMN "access_control"."company_dashboards"."assigned_by" IS 'public.users.id of who assigned it.';

COMMENT ON COLUMN "access_control"."company_dashboards"."assigned_at" IS 'When it was assigned.';

COMMENT ON TABLE "access_control"."dashboard_user_access" IS 'Dashboards shared with one person. One row per person and dashboard, each with its own level.';

COMMENT ON COLUMN "access_control"."dashboard_user_access"."user_id" IS 'public.users.id.';

COMMENT ON COLUMN "access_control"."dashboard_user_access"."dashboard_id" IS 'public.dashboards.id.';

COMMENT ON COLUMN "access_control"."dashboard_user_access"."access_level_id" IS 'access_control.access_levels.id of a dashboard level.';

COMMENT ON COLUMN "access_control"."dashboard_user_access"."granted_by" IS 'public.users.id of who gave this access.';

COMMENT ON COLUMN "access_control"."dashboard_user_access"."granted_at" IS 'When this access was given.';

COMMENT ON TABLE "access_control"."dashboard_group_access" IS 'Dashboards shared with a group. One row per group and dashboard, each with its own level.';

COMMENT ON COLUMN "access_control"."dashboard_group_access"."group_id" IS 'public.groups.id.';

COMMENT ON COLUMN "access_control"."dashboard_group_access"."dashboard_id" IS 'public.dashboards.id.';

COMMENT ON COLUMN "access_control"."dashboard_group_access"."access_level_id" IS 'access_control.access_levels.id of a dashboard level.';

COMMENT ON COLUMN "access_control"."dashboard_group_access"."granted_by" IS 'public.users.id of who gave this access.';

COMMENT ON COLUMN "access_control"."dashboard_group_access"."granted_at" IS 'When this access was given.';

COMMENT ON TABLE "access_control"."context_user_access" IS 'Contexts shared with one person. One row per person and context, each with its own level.';

COMMENT ON COLUMN "access_control"."context_user_access"."connection_id" IS 'public.connections.id (the context).';

COMMENT ON COLUMN "access_control"."context_user_access"."user_id" IS 'public.users.id.';

COMMENT ON COLUMN "access_control"."context_user_access"."access_level_id" IS 'access_control.access_levels.id of a context level.';

COMMENT ON COLUMN "access_control"."context_user_access"."granted_by" IS 'public.users.id of who gave this access.';

COMMENT ON COLUMN "access_control"."context_user_access"."granted_at" IS 'When this access was given.';

COMMENT ON TABLE "access_control"."context_group_access" IS 'Contexts shared with a group. One row per group and context, each with its own level.';

COMMENT ON COLUMN "access_control"."context_group_access"."connection_id" IS 'public.connections.id (the context).';

COMMENT ON COLUMN "access_control"."context_group_access"."group_id" IS 'public.groups.id.';

COMMENT ON COLUMN "access_control"."context_group_access"."access_level_id" IS 'access_control.access_levels.id of a context level.';

COMMENT ON COLUMN "access_control"."context_group_access"."granted_by" IS 'public.users.id of who gave this access.';

COMMENT ON COLUMN "access_control"."context_group_access"."granted_at" IS 'When this access was given.';

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
