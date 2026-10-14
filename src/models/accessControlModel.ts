import { ACCESS_SCHEMA, T, V } from './rbacModel';
import { CT } from './contextModel';
import { quoteIdentifier } from '../tools/sql';

const S = quoteIdentifier(ACCESS_SCHEMA);
const fn = (name: string) => `${S}.${quoteIdentifier(name)}`;

const SCHEMA = [`CREATE SCHEMA IF NOT EXISTS ${S}`];

const TABLES = [
  `CREATE TABLE IF NOT EXISTS ${T.features} (
     id          UUID         PRIMARY KEY,
     key         VARCHAR(64)  NOT NULL,
     label       VARCHAR(120) NOT NULL,
     description TEXT         NULL,
     locked      BOOLEAN      NOT NULL DEFAULT FALSE,
     covers      TEXT[]       NOT NULL DEFAULT '{}',
     sort_order  INTEGER      NOT NULL DEFAULT 0,
     created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
     updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
     CONSTRAINT uq_features_key UNIQUE (key)
   )`,

  `CREATE TABLE IF NOT EXISTS ${T.permissions} (
     id                  UUID         PRIMARY KEY,
     key                 VARCHAR(100) NOT NULL,
     label               VARCHAR(120) NOT NULL,
     description         TEXT         NULL,
     feature_id          UUID         NULL
                           CONSTRAINT fk_permissions_feature_id REFERENCES ${T.features} (id) ON DELETE SET NULL,
     platform_only       BOOLEAN      NOT NULL DEFAULT FALSE,
     admin_only          BOOLEAN      NOT NULL DEFAULT FALSE,
     sort_order          INTEGER      NOT NULL DEFAULT 0,
     defaults_applied_at TIMESTAMPTZ  NULL,
     created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
     updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
     CONSTRAINT uq_permissions_key UNIQUE (key)
   )`,

  `CREATE TABLE IF NOT EXISTS ${T.accessLevels} (
     id          UUID        PRIMARY KEY,
     resource    VARCHAR(16) NOT NULL,
     key         VARCHAR(16) NOT NULL,
     rank        INTEGER     NOT NULL,
     label       VARCHAR(60) NOT NULL,
     description TEXT        NULL,
     CONSTRAINT uq_access_levels_resource_key UNIQUE (resource, key),
     CONSTRAINT chk_access_levels_resource CHECK (resource IN ('dashboard','context'))
   )`,

  `CREATE TABLE IF NOT EXISTS ${T.roles} (
     id          UUID         PRIMARY KEY,
     company_id  INTEGER      NULL
                   CONSTRAINT fk_roles_company_id REFERENCES ${T.companies} (id) ON DELETE CASCADE,
     kind        VARCHAR(16)  NOT NULL,
     tier        VARCHAR(16)  NOT NULL,
     name        VARCHAR(50)  NOT NULL,
     description VARCHAR(255) NULL,
     created_by  INTEGER      NULL
                   CONSTRAINT fk_roles_created_by REFERENCES ${T.users} (id) ON DELETE SET NULL,
     created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
     updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
     modified_by INTEGER      NULL
                   CONSTRAINT fk_roles_modified_by REFERENCES ${T.users} (id) ON DELETE SET NULL,
     modified_at TIMESTAMPTZ  NULL,
     CONSTRAINT uq_roles_company_name UNIQUE (company_id, name),
     CONSTRAINT chk_roles_kind CHECK (kind IN ('system','company_default','custom')),
     CONSTRAINT chk_roles_tier CHECK (tier IN ('SUPER_ADMIN','COMPANY_ADMIN','USER')),
     CONSTRAINT chk_roles_company CHECK ((kind = 'system') = (company_id IS NULL)),
     CONSTRAINT chk_roles_company_tier CHECK (kind = 'system' OR tier = 'USER')
   )`,

  `CREATE TABLE IF NOT EXISTS ${T.rolePermissions} (
     role_id        UUID        PRIMARY KEY
                      CONSTRAINT fk_role_permissions_role_id REFERENCES ${T.roles} (id) ON DELETE CASCADE,
     permission_ids UUID[]      NOT NULL DEFAULT '{}',
     updated_by     INTEGER     NULL
                      CONSTRAINT fk_role_permissions_updated_by REFERENCES ${T.users} (id) ON DELETE SET NULL,
     updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS ${T.companyFeatures} (
     company_id  INTEGER     PRIMARY KEY
                   CONSTRAINT fk_company_features_company_id REFERENCES ${T.companies} (id) ON DELETE CASCADE,
     feature_ids UUID[]      NOT NULL DEFAULT '{}',
     updated_by  INTEGER     NULL
                   CONSTRAINT fk_company_features_updated_by REFERENCES ${T.users} (id) ON DELETE SET NULL,
     updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS ${T.userRoles} (
     user_id     INTEGER     PRIMARY KEY
                   CONSTRAINT fk_user_roles_user_id REFERENCES ${T.users} (id) ON DELETE CASCADE,
     role_id     UUID        NOT NULL
                   CONSTRAINT fk_user_roles_role_id REFERENCES ${T.roles} (id) ON DELETE RESTRICT,
     assigned_by INTEGER     NULL
                   CONSTRAINT fk_user_roles_assigned_by REFERENCES ${T.users} (id) ON DELETE SET NULL,
     assigned_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS ${T.userPermissions} (
     user_id        INTEGER     PRIMARY KEY
                      CONSTRAINT fk_user_permissions_user_id REFERENCES ${T.users} (id) ON DELETE CASCADE,
     permission_ids UUID[]      NOT NULL DEFAULT '{}',
     updated_by     INTEGER     NULL
                      CONSTRAINT fk_user_permissions_updated_by REFERENCES ${T.users} (id) ON DELETE SET NULL,
     updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS ${T.userDataScopes} (
     user_id    INTEGER     PRIMARY KEY
                  CONSTRAINT fk_user_data_scopes_user_id REFERENCES ${T.users} (id) ON DELETE CASCADE,
     scopes     JSONB       NOT NULL DEFAULT '{}'::jsonb,
     updated_by INTEGER     NULL
                  CONSTRAINT fk_user_data_scopes_updated_by REFERENCES ${T.users} (id) ON DELETE SET NULL,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT chk_user_data_scopes_object CHECK (jsonb_typeof(scopes) = 'object')
   )`,

  `CREATE TABLE IF NOT EXISTS ${T.companyDashboards} (
     company_id   INTEGER     NOT NULL
                    CONSTRAINT fk_company_dashboards_company_id REFERENCES ${T.companies} (id) ON DELETE CASCADE,
     dashboard_id VARCHAR(64) NOT NULL
                    CONSTRAINT fk_company_dashboards_dashboard_id REFERENCES ${T.dashboards} (id) ON DELETE CASCADE,
     assigned_by  INTEGER     NULL
                    CONSTRAINT fk_company_dashboards_assigned_by REFERENCES ${T.users} (id) ON DELETE SET NULL,
     assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (company_id, dashboard_id)
   )`,

  `CREATE TABLE IF NOT EXISTS ${T.dashboardUserAccess} (
     user_id         INTEGER     NOT NULL
                       CONSTRAINT fk_dashboard_user_access_user_id REFERENCES ${T.users} (id) ON DELETE CASCADE,
     dashboard_id    VARCHAR(64) NOT NULL
                       CONSTRAINT fk_dashboard_user_access_dashboard_id REFERENCES ${T.dashboards} (id) ON DELETE CASCADE,
     access_level_id UUID        NOT NULL
                       CONSTRAINT fk_dashboard_user_access_access_level_id REFERENCES ${T.accessLevels} (id),
     granted_by      INTEGER     NULL
                       CONSTRAINT fk_dashboard_user_access_granted_by REFERENCES ${T.users} (id) ON DELETE SET NULL,
     granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (user_id, dashboard_id)
   )`,

  `CREATE TABLE IF NOT EXISTS ${T.dashboardGroupAccess} (
     group_id        INTEGER     NOT NULL
                       CONSTRAINT fk_dashboard_group_access_group_id REFERENCES ${T.groups} (id) ON DELETE CASCADE,
     dashboard_id    VARCHAR(64) NOT NULL
                       CONSTRAINT fk_dashboard_group_access_dashboard_id REFERENCES ${T.dashboards} (id) ON DELETE CASCADE,
     access_level_id UUID        NOT NULL
                       CONSTRAINT fk_dashboard_group_access_access_level_id REFERENCES ${T.accessLevels} (id),
     granted_by      INTEGER     NULL
                       CONSTRAINT fk_dashboard_group_access_granted_by REFERENCES ${T.users} (id) ON DELETE SET NULL,
     granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (group_id, dashboard_id)
   )`,

  `CREATE TABLE IF NOT EXISTS ${T.contextUserAccess} (
     connection_id   UUID        NOT NULL
                       CONSTRAINT fk_context_user_access_connection_id REFERENCES ${CT.connections} (id) ON DELETE CASCADE,
     user_id         INTEGER     NOT NULL
                       CONSTRAINT fk_context_user_access_user_id REFERENCES ${T.users} (id) ON DELETE CASCADE,
     access_level_id UUID        NOT NULL
                       CONSTRAINT fk_context_user_access_access_level_id REFERENCES ${T.accessLevels} (id),
     granted_by      INTEGER     NULL
                       CONSTRAINT fk_context_user_access_granted_by REFERENCES ${T.users} (id) ON DELETE SET NULL,
     granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (connection_id, user_id)
   )`,

  `CREATE TABLE IF NOT EXISTS ${T.contextGroupAccess} (
     connection_id   UUID        NOT NULL
                       CONSTRAINT fk_context_group_access_connection_id REFERENCES ${CT.connections} (id) ON DELETE CASCADE,
     group_id        INTEGER     NOT NULL
                       CONSTRAINT fk_context_group_access_group_id REFERENCES ${T.groups} (id) ON DELETE CASCADE,
     access_level_id UUID        NOT NULL
                       CONSTRAINT fk_context_group_access_access_level_id REFERENCES ${T.accessLevels} (id),
     granted_by      INTEGER     NULL
                       CONSTRAINT fk_context_group_access_granted_by REFERENCES ${T.users} (id) ON DELETE SET NULL,
     granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (connection_id, group_id)
   )`,
];

const INDEXES = [
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_system_tier ON ${T.roles} (tier) WHERE kind = 'system'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_company_default ON ${T.roles} (company_id, tier) WHERE kind = 'company_default'`,
  `CREATE INDEX IF NOT EXISTS idx_permissions_feature_id ON ${T.permissions} (feature_id)`,
  `CREATE INDEX IF NOT EXISTS idx_roles_company_id ON ${T.roles} (company_id)`,
  `CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_ids ON ${T.rolePermissions} USING GIN (permission_ids)`,
  `CREATE INDEX IF NOT EXISTS idx_user_permissions_permission_ids ON ${T.userPermissions} USING GIN (permission_ids)`,
  `CREATE INDEX IF NOT EXISTS idx_company_features_feature_ids ON ${T.companyFeatures} USING GIN (feature_ids)`,
  `CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON ${T.userRoles} (role_id)`,
  `CREATE INDEX IF NOT EXISTS idx_company_dashboards_dashboard_id ON ${T.companyDashboards} (dashboard_id)`,
  `CREATE INDEX IF NOT EXISTS idx_dashboard_user_access_dashboard_id ON ${T.dashboardUserAccess} (dashboard_id)`,
  `CREATE INDEX IF NOT EXISTS idx_dashboard_group_access_dashboard_id ON ${T.dashboardGroupAccess} (dashboard_id)`,
  `CREATE INDEX IF NOT EXISTS idx_context_user_access_user_id ON ${T.contextUserAccess} (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_context_group_access_group_id ON ${T.contextGroupAccess} (group_id)`,
];

const trigger = (name: string, table: string, timing: string, func: string, args = '') => [
  `DROP TRIGGER IF EXISTS ${name} ON ${table}`,
  `CREATE TRIGGER ${name} ${timing} ON ${table} FOR EACH ROW EXECUTE FUNCTION ${func}(${args})`,
];

const TRIGGERS = [
  `CREATE OR REPLACE FUNCTION ${fn('check_permission_ids')}() RETURNS trigger AS $$
   DECLARE
     unknown_ids UUID[];
     restricted  TEXT[];
     company_held BOOLEAN;
   BEGIN
     SELECT array_agg(p) INTO unknown_ids
       FROM unnest(COALESCE(NEW.permission_ids, '{}')) AS p
      WHERE p IS NULL OR NOT EXISTS (SELECT 1 FROM ${T.permissions} x WHERE x.id = p);
     IF unknown_ids IS NOT NULL THEN
       RAISE EXCEPTION 'unknown permission id(s): %', unknown_ids USING ERRCODE = 'foreign_key_violation';
     END IF;

     IF TG_TABLE_NAME = 'role_permissions' THEN
       SELECT r.kind <> 'system' INTO company_held FROM ${T.roles} r WHERE r.id = NEW.role_id;
     ELSE
       company_held := TRUE;
     END IF;

     IF company_held THEN
       SELECT array_agg(x.key ORDER BY x.sort_order) INTO restricted
         FROM ${T.permissions} x
        WHERE x.id = ANY(NEW.permission_ids) AND (x.platform_only OR x.admin_only);
       IF restricted IS NOT NULL THEN
         RAISE EXCEPTION 'permission(s) % can only be held by a built-in administrator role', restricted
           USING ERRCODE = 'check_violation';
       END IF;
     END IF;

     NEW.permission_ids := ARRAY(
       SELECT x.id FROM ${T.permissions} x WHERE x.id = ANY(NEW.permission_ids) ORDER BY x.sort_order, x.key
     );
     RETURN NEW;
   END $$ LANGUAGE plpgsql`,
  ...trigger('trg_role_permissions_check', T.rolePermissions, 'BEFORE INSERT OR UPDATE', fn('check_permission_ids')),
  ...trigger('trg_user_permissions_check', T.userPermissions, 'BEFORE INSERT OR UPDATE', fn('check_permission_ids')),

  `CREATE OR REPLACE FUNCTION ${fn('check_feature_ids')}() RETURNS trigger AS $$
   DECLARE
     unknown_ids UUID[];
   BEGIN
     SELECT array_agg(f) INTO unknown_ids
       FROM unnest(COALESCE(NEW.feature_ids, '{}')) AS f
      WHERE f IS NULL OR NOT EXISTS (SELECT 1 FROM ${T.features} x WHERE x.id = f);
     IF unknown_ids IS NOT NULL THEN
       RAISE EXCEPTION 'unknown feature id(s): %', unknown_ids USING ERRCODE = 'foreign_key_violation';
     END IF;
     NEW.feature_ids := ARRAY(
       SELECT x.id FROM ${T.features} x WHERE x.id = ANY(NEW.feature_ids) ORDER BY x.sort_order, x.key
     );
     RETURN NEW;
   END $$ LANGUAGE plpgsql`,
  ...trigger('trg_company_features_check', T.companyFeatures, 'BEFORE INSERT OR UPDATE', fn('check_feature_ids')),

  `CREATE OR REPLACE FUNCTION ${fn('forget_permission')}() RETURNS trigger AS $$
   BEGIN
     UPDATE ${T.rolePermissions} SET permission_ids = array_remove(permission_ids, OLD.id), updated_at = now()
      WHERE OLD.id = ANY(permission_ids);
     UPDATE ${T.userPermissions} SET permission_ids = array_remove(permission_ids, OLD.id), updated_at = now()
      WHERE OLD.id = ANY(permission_ids);
     RETURN OLD;
   END $$ LANGUAGE plpgsql`,
  ...trigger('trg_permissions_forget', T.permissions, 'AFTER DELETE', fn('forget_permission')),

  `CREATE OR REPLACE FUNCTION ${fn('forget_feature')}() RETURNS trigger AS $$
   BEGIN
     UPDATE ${T.companyFeatures} SET feature_ids = array_remove(feature_ids, OLD.id), updated_at = now()
      WHERE OLD.id = ANY(feature_ids);
     RETURN OLD;
   END $$ LANGUAGE plpgsql`,
  ...trigger('trg_features_forget', T.features, 'AFTER DELETE', fn('forget_feature')),

  `CREATE OR REPLACE FUNCTION ${fn('check_user_role')}() RETURNS trigger AS $$
   DECLARE
     role_row RECORD;
     user_company INTEGER;
   BEGIN
     SELECT company_id, kind, tier INTO role_row FROM ${T.roles} WHERE id = NEW.role_id;
     SELECT company_id INTO user_company FROM ${T.users} WHERE id = NEW.user_id;
     IF role_row.kind <> 'system' AND role_row.company_id IS DISTINCT FROM user_company THEN
       RAISE EXCEPTION 'role % belongs to another company than user %', NEW.role_id, NEW.user_id
         USING ERRCODE = 'check_violation';
     END IF;
     IF (role_row.tier = 'SUPER_ADMIN') <> (user_company IS NULL) THEN
       RAISE EXCEPTION 'only a platform account (no company) holds SUPER_ADMIN, and it holds nothing else'
         USING ERRCODE = 'check_violation';
     END IF;
     RETURN NEW;
   END $$ LANGUAGE plpgsql`,
  ...trigger('trg_user_roles_check', T.userRoles, 'BEFORE INSERT OR UPDATE', fn('check_user_role')),

  `CREATE OR REPLACE FUNCTION ${fn('check_access_level')}() RETURNS trigger AS $$
   BEGIN
     IF NOT EXISTS (SELECT 1 FROM ${T.accessLevels} l WHERE l.id = NEW.access_level_id AND l.resource = TG_ARGV[0]) THEN
       RAISE EXCEPTION 'access level % is not a % access level', NEW.access_level_id, TG_ARGV[0]
         USING ERRCODE = 'check_violation';
     END IF;
     RETURN NEW;
   END $$ LANGUAGE plpgsql`,
  ...trigger('trg_dashboard_user_access_level', T.dashboardUserAccess, 'BEFORE INSERT OR UPDATE', fn('check_access_level'), "'dashboard'"),
  ...trigger('trg_dashboard_group_access_level', T.dashboardGroupAccess, 'BEFORE INSERT OR UPDATE', fn('check_access_level'), "'dashboard'"),
  ...trigger('trg_context_user_access_level', T.contextUserAccess, 'BEFORE INSERT OR UPDATE', fn('check_access_level'), "'context'"),
  ...trigger('trg_context_group_access_level', T.contextGroupAccess, 'BEFORE INSERT OR UPDATE', fn('check_access_level'), "'context'"),
];

const COMPANY_DASHBOARDS = `(
  SELECT cd.company_id, cd.dashboard_id FROM ${T.companyDashboards} cd
  UNION
  SELECT d.company_id, d.id FROM ${T.dashboards} d WHERE d.company_id IS NOT NULL
)`;

const holds = (userColumn: string, permission: string) => `EXISTS (
  SELECT 1 FROM ${V.userEffectivePermissions} e
   WHERE e.user_id = ${userColumn} AND e.permission_key = '${permission}' AND e.is_effective)`;

const PLATFORM_USERS = `SELECT ur.user_id FROM ${T.userRoles} ur
  JOIN ${T.roles} r ON r.id = ur.role_id AND r.tier = 'SUPER_ADMIN'`;

const VIEW_NAMES = [
  V.companyFeatureSummary,
  V.rolePermissionSummary,
  V.userAccessSummary,
  V.userResourceAccess,
  V.userEffectivePermissions,
];

const VIEWS = [
  ...VIEW_NAMES.map((name) => `DROP VIEW IF EXISTS ${name} CASCADE`),

  `CREATE VIEW ${V.userEffectivePermissions} AS
   SELECT u.id AS user_id, u.username, u.email, u.company_id, c.name AS company_name,
          r.id AS role_id, r.name AS role_name, r.tier AS role_tier,
          p.id AS permission_id, p.key AS permission_key, p.label AS permission_label,
          f.key AS feature_key,
          held.via_role, held.via_user_grant,
          (u.company_id IS NULL OR p.feature_id IS NULL OR COALESCE(f.locked, FALSE)
            OR p.feature_id = ANY(COALESCE(cf.feature_ids, '{}'::uuid[]))) AS is_effective
     FROM ${T.users} u
     LEFT JOIN ${T.companies} c ON c.id = u.company_id
     LEFT JOIN ${T.userRoles} ur ON ur.user_id = u.id
     LEFT JOIN ${T.roles} r ON r.id = ur.role_id
     LEFT JOIN ${T.companyFeatures} cf ON cf.company_id = u.company_id
     CROSS JOIN LATERAL (
       SELECT src.permission_id,
              bool_or(src.source = 'role') AS via_role,
              bool_or(src.source = 'user_grant') AS via_user_grant
         FROM (
           SELECT unnest(rp.permission_ids) AS permission_id, 'role' AS source
             FROM ${T.rolePermissions} rp WHERE rp.role_id = r.id
           UNION ALL
           SELECT unnest(up.permission_ids), 'user_grant'
             FROM ${T.userPermissions} up WHERE up.user_id = u.id
         ) src
        GROUP BY src.permission_id
     ) held
     JOIN ${T.permissions} p ON p.id = held.permission_id
     LEFT JOIN ${T.features} f ON f.id = p.feature_id`,

  `CREATE VIEW ${V.userResourceAccess} AS
   WITH company_dashboards AS ${COMPANY_DASHBOARDS},
   sources AS (
     SELECT pu.user_id, 'dashboard'::text AS resource_type, d.id::text AS resource_id,
            'admin'::text AS level_key, 'platform owner'::text AS via
       FROM (${PLATFORM_USERS}) pu CROSS JOIN ${T.dashboards} d
     UNION ALL
     SELECT u.id, 'dashboard', cd.dashboard_id, 'admin', 'permission access.grant'
       FROM ${T.users} u JOIN company_dashboards cd ON cd.company_id = u.company_id
      WHERE ${holds('u.id', 'access.grant')}
     UNION ALL
     SELECT a.user_id, 'dashboard', a.dashboard_id, l.key, 'shared directly'
       FROM ${T.dashboardUserAccess} a
       JOIN ${T.users} u ON u.id = a.user_id
       JOIN company_dashboards cd ON cd.company_id = u.company_id AND cd.dashboard_id = a.dashboard_id
       JOIN ${T.accessLevels} l ON l.id = a.access_level_id
     UNION ALL
     SELECT gu.user_id, 'dashboard', ga.dashboard_id, l.key, 'group ' || g.name
       FROM ${T.dashboardGroupAccess} ga
       JOIN ${T.groups} g ON g.id = ga.group_id AND g.active
       JOIN ${T.groupUsers} gu ON gu.group_id = g.id
       JOIN ${T.users} u ON u.id = gu.user_id AND u.company_id = g.company_id
       JOIN company_dashboards cd ON cd.company_id = u.company_id AND cd.dashboard_id = ga.dashboard_id
       JOIN ${T.accessLevels} l ON l.id = ga.access_level_id
     UNION ALL
     SELECT pu.user_id, 'context', cn.id::text, 'full', 'platform owner'
       FROM (${PLATFORM_USERS}) pu CROSS JOIN ${CT.connections} cn
     UNION ALL
     SELECT u.id, 'context', cn.id::text, 'full', 'permission context.manage_all'
       FROM ${T.users} u JOIN ${CT.connections} cn ON cn.company_id = u.company_id
      WHERE ${holds('u.id', 'context.manage_all')}
     UNION ALL
     SELECT cn.created_by, 'context', cn.id::text, 'full', 'owner'
       FROM ${CT.connections} cn
       JOIN ${T.users} u ON u.id = cn.created_by AND u.company_id = cn.company_id
     UNION ALL
     SELECT a.user_id, 'context', a.connection_id::text, l.key, 'shared directly'
       FROM ${T.contextUserAccess} a
       JOIN ${CT.connections} cn ON cn.id = a.connection_id
       JOIN ${T.users} u ON u.id = a.user_id AND u.company_id = cn.company_id
       JOIN ${T.accessLevels} l ON l.id = a.access_level_id
     UNION ALL
     SELECT gu.user_id, 'context', ga.connection_id::text, l.key, 'group ' || g.name
       FROM ${T.contextGroupAccess} ga
       JOIN ${T.groups} g ON g.id = ga.group_id AND g.active
       JOIN ${T.groupUsers} gu ON gu.group_id = g.id
       JOIN ${CT.connections} cn ON cn.id = ga.connection_id
       JOIN ${T.users} u ON u.id = gu.user_id AND u.company_id = cn.company_id
       JOIN ${T.accessLevels} l ON l.id = ga.access_level_id
     UNION ALL
     SELECT u.id, 'context', cn.id::text, 'view', 'everyone in the company'
       FROM ${CT.connections} cn JOIN ${T.users} u ON u.company_id = cn.company_id
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
     JOIN ${T.users} u ON u.id = s.user_id
     LEFT JOIN ${T.companies} co ON co.id = u.company_id
     JOIN ${T.accessLevels} l ON l.resource = s.resource_type AND l.key = s.level_key
     LEFT JOIN ${T.dashboards} d ON s.resource_type = 'dashboard' AND d.id = s.resource_id
     LEFT JOIN ${CT.connections} cn ON s.resource_type = 'context' AND cn.id::text = s.resource_id
    WHERE (s.resource_type = 'dashboard' AND ${holds('s.user_id', 'dashboard.read')})
       OR (s.resource_type = 'context' AND ${holds('s.user_id', 'context.read')})
    GROUP BY s.user_id, u.username, u.email, co.name, s.resource_type, s.resource_id, d.title, cn.name`,

  `CREATE VIEW ${V.userAccessSummary} AS
   SELECT u.id AS user_id, u.username, u.email, u.display_name, u.status,
          c.name AS company_name,
          r.name AS role_name, r.tier AS role_tier, r.kind AS role_kind,
          COALESCE((SELECT array_agg(e.permission_key ORDER BY e.permission_key)
                      FROM ${V.userEffectivePermissions} e
                     WHERE e.user_id = u.id AND e.is_effective), '{}') AS permissions,
          COALESCE((SELECT array_agg(p.key ORDER BY p.key)
                      FROM ${T.userPermissions} up
                      CROSS JOIN LATERAL unnest(up.permission_ids) AS pid
                      JOIN ${T.permissions} p ON p.id = pid
                     WHERE up.user_id = u.id), '{}') AS extra_permissions,
          COALESCE((SELECT array_agg(f.key ORDER BY f.sort_order)
                      FROM ${T.features} f
                     WHERE u.company_id IS NULL OR f.locked
                        OR f.id = ANY(COALESCE(cf.feature_ids, '{}'::uuid[]))), '{}') AS features,
          COALESCE((SELECT array_agg(g.name ORDER BY g.name)
                      FROM ${T.groupUsers} gu JOIN ${T.groups} g ON g.id = gu.group_id
                     WHERE gu.user_id = u.id), '{}') AS groups,
          COALESCE((SELECT array_agg(ra.resource_name || ': ' || ra.access_level_label ORDER BY ra.resource_name)
                      FROM ${V.userResourceAccess} ra
                     WHERE ra.user_id = u.id AND ra.resource_type = 'dashboard'), '{}') AS dashboards,
          COALESCE((SELECT array_agg(ra.resource_name || ': ' || ra.access_level_label ORDER BY ra.resource_name)
                      FROM ${V.userResourceAccess} ra
                     WHERE ra.user_id = u.id AND ra.resource_type = 'context'), '{}') AS contexts,
          COALESCE(ds.scopes, '{}'::jsonb) AS data_scopes
     FROM ${T.users} u
     LEFT JOIN ${T.companies} c ON c.id = u.company_id
     LEFT JOIN ${T.userRoles} ur ON ur.user_id = u.id
     LEFT JOIN ${T.roles} r ON r.id = ur.role_id
     LEFT JOIN ${T.companyFeatures} cf ON cf.company_id = u.company_id
     LEFT JOIN ${T.userDataScopes} ds ON ds.user_id = u.id`,

  `CREATE VIEW ${V.rolePermissionSummary} AS
   SELECT r.id AS role_id, r.name AS role_name, r.kind AS role_kind, r.tier AS role_tier,
          COALESCE(c.name, 'All companies') AS company_name,
          COALESCE((SELECT array_agg(p.key ORDER BY p.sort_order)
                      FROM unnest(rp.permission_ids) AS pid JOIN ${T.permissions} p ON p.id = pid), '{}') AS permissions,
          COALESCE(cardinality(rp.permission_ids), 0) AS permission_count,
          (SELECT COUNT(*) FROM ${T.userRoles} ur WHERE ur.role_id = r.id) AS user_count,
          rp.updated_at AS permissions_updated_at,
          (SELECT uu.username FROM ${T.users} uu WHERE uu.id = rp.updated_by) AS permissions_updated_by
     FROM ${T.roles} r
     LEFT JOIN ${T.companies} c ON c.id = r.company_id
     LEFT JOIN ${T.rolePermissions} rp ON rp.role_id = r.id`,

  `CREATE VIEW ${V.companyFeatureSummary} AS
   SELECT c.id AS company_id, c.name AS company_name,
          COALESCE(array_agg(f.key ORDER BY f.sort_order)
                     FILTER (WHERE f.locked OR f.id = ANY(COALESCE(cf.feature_ids, '{}'::uuid[]))), '{}') AS enabled_features,
          COALESCE(array_agg(f.key ORDER BY f.sort_order)
                     FILTER (WHERE NOT f.locked AND NOT f.id = ANY(COALESCE(cf.feature_ids, '{}'::uuid[]))), '{}') AS disabled_features,
          COALESCE(array_agg(f.key ORDER BY f.sort_order) FILTER (WHERE f.locked), '{}') AS locked_features,
          cf.updated_at,
          (SELECT uu.username FROM ${T.users} uu WHERE uu.id = cf.updated_by) AS updated_by
     FROM ${T.companies} c
     LEFT JOIN ${T.companyFeatures} cf ON cf.company_id = c.id
     CROSS JOIN ${T.features} f
    GROUP BY c.id, c.name, cf.feature_ids, cf.updated_at, cf.updated_by`,
];

const DESCRIPTIONS: Record<string, { kind: 'TABLE' | 'VIEW'; about: string; columns: Record<string, string> }> = {
  [T.features]: {
    kind: 'TABLE',
    about: 'Product features a company can have switched on. One row per feature.',
    columns: {
      id: 'Fixed UUID of the feature, identical in every environment.',
      key: 'Readable code used by the application, e.g. dashboards.',
      locked: 'TRUE when every company always has this feature.',
      covers: 'Screens of the application this feature unlocks.',
    },
  },
  [T.permissions]: {
    kind: 'TABLE',
    about: 'Every action a role or a person can be allowed to do. One row per permission.',
    columns: {
      id: 'Fixed UUID of the permission, identical in every environment.',
      key: 'Readable code checked by the application, e.g. dashboard.read.',
      feature_id: 'access_control.features.id this permission belongs to. NULL = always available.',
      platform_only: 'TRUE when only the platform owner can hold it.',
      admin_only: 'TRUE when only the built-in company admin role can hold it.',
      defaults_applied_at: 'When the built-in roles were given this permission by default.',
    },
  },
  [T.accessLevels]: {
    kind: 'TABLE',
    about: 'Levels of access a person or group can be given on one dashboard or context.',
    columns: {
      resource: 'dashboard or context.',
      key: 'Readable code, e.g. view, share, edit, full.',
      rank: 'Higher rank includes everything a lower rank allows.',
    },
  },
  [T.roles]: {
    kind: 'TABLE',
    about: 'Roles. Built-in roles have no company; a company has its own Member role and its custom roles.',
    columns: {
      company_id: 'public.companies.id. NULL for the built-in platform-wide roles.',
      kind: 'system = built-in for every company, company_default = the company own Member role, custom = made by the company.',
      tier: 'SUPER_ADMIN, COMPANY_ADMIN or USER. Decides what the role may manage.',
      modified_at: 'Set when a company changed its Member role away from the built-in defaults.',
    },
  },
  [T.rolePermissions]: {
    kind: 'TABLE',
    about: 'The permissions of each role. One row per role.',
    columns: {
      role_id: 'access_control.roles.id.',
      permission_ids: 'UUIDs from access_control.permissions.id. Readable form: access_control.role_permission_summary.',
    },
  },
  [T.companyFeatures]: {
    kind: 'TABLE',
    about: 'The features each company has switched on. One row per company. Locked features are always on.',
    columns: {
      company_id: 'public.companies.id.',
      feature_ids: 'UUIDs from access_control.features.id. Readable form: access_control.company_feature_summary.',
    },
  },
  [T.userRoles]: {
    kind: 'TABLE',
    about: 'The role of each person. One row per user.',
    columns: {
      user_id: 'public.users.id.',
      role_id: 'access_control.roles.id.',
    },
  },
  [T.userPermissions]: {
    kind: 'TABLE',
    about: 'Extra permissions given to one person on top of their role. One row per user.',
    columns: {
      user_id: 'public.users.id.',
      permission_ids: 'UUIDs from access_control.permissions.id. Readable form: access_control.user_access_summary.extra_permissions.',
    },
  },
  [T.userDataScopes]: {
    kind: 'TABLE',
    about: 'Row-level data scopes of each person. One row per user.',
    columns: {
      user_id: 'public.users.id.',
      scopes: 'Object of dimension name to the list of values the person may see, e.g. {"region": ["EU"]}.',
    },
  },
  [T.companyDashboards]: {
    kind: 'TABLE',
    about: 'Dashboards the platform made available to a company. One row per company and dashboard.',
    columns: {},
  },
  [T.dashboardUserAccess]: {
    kind: 'TABLE',
    about: 'Dashboards shared with one person. One row per person and dashboard, each with its own level.',
    columns: { access_level_id: 'access_control.access_levels.id of a dashboard level.' },
  },
  [T.dashboardGroupAccess]: {
    kind: 'TABLE',
    about: 'Dashboards shared with a group. One row per group and dashboard, each with its own level.',
    columns: { access_level_id: 'access_control.access_levels.id of a dashboard level.' },
  },
  [T.contextUserAccess]: {
    kind: 'TABLE',
    about: 'Contexts shared with one person. One row per person and context, each with its own level.',
    columns: { access_level_id: 'access_control.access_levels.id of a context level.' },
  },
  [T.contextGroupAccess]: {
    kind: 'TABLE',
    about: 'Contexts shared with a group. One row per group and context, each with its own level.',
    columns: { access_level_id: 'access_control.access_levels.id of a context level.' },
  },
  [V.userEffectivePermissions]: {
    kind: 'VIEW',
    about: 'Every permission each person holds and where it comes from. The application loads permissions from this view.',
    columns: {
      via_role: 'TRUE when the person role gives this permission.',
      via_user_grant: 'TRUE when it was given to the person directly.',
      is_effective: 'FALSE when the company has the feature of this permission switched off.',
    },
  },
  [V.userResourceAccess]: {
    kind: 'VIEW',
    about: 'Every dashboard and context each person can open, with the strongest level and how they got it. A person needs dashboard.read or context.read to open anything at all.',
    columns: {
      access_level: 'Strongest level the person holds on this item.',
      granted_via: 'Every reason the person can open it, with the level each reason gives.',
    },
  },
  [V.userAccessSummary]: {
    kind: 'VIEW',
    about: 'One row per person: role, permissions, features, groups, dashboards, contexts and data scopes.',
    columns: {},
  },
  [V.rolePermissionSummary]: {
    kind: 'VIEW',
    about: 'One row per role with its permissions written out and how many people hold it.',
    columns: {},
  },
  [V.companyFeatureSummary]: {
    kind: 'VIEW',
    about: 'One row per company with the features it has on and off.',
    columns: {},
  },
};

const COMMON_COLUMNS: Record<string, string> = {
  id: 'UUID primary key.',
  key: 'Readable code used by the application.',
  label: 'Name shown to people.',
  name: 'Name shown to people.',
  description: 'What it is for.',
  sort_order: 'Display order.',
  user_id: 'public.users.id.',
  username: 'public.users.username.',
  email: 'public.users.email.',
  display_name: 'public.users.display_name.',
  status: 'public.users.status: pending, active or disabled.',
  group_id: 'public.groups.id.',
  company_id: 'public.companies.id.',
  company_name: 'public.companies.name.',
  dashboard_id: 'public.dashboards.id.',
  connection_id: 'public.connections.id (the context).',
  role_id: 'access_control.roles.id.',
  role_name: 'access_control.roles.name.',
  role_tier: 'access_control.roles.tier.',
  role_kind: 'access_control.roles.kind.',
  permission_id: 'access_control.permissions.id.',
  permission_key: 'access_control.permissions.key.',
  permission_label: 'access_control.permissions.label.',
  feature_key: 'access_control.features.key the permission belongs to.',
  resource_type: 'dashboard or context.',
  resource_id: 'public.dashboards.id or public.connections.id.',
  resource_name: 'Dashboard title or context name.',
  access_level_id: 'access_control.access_levels.id.',
  access_level_label: 'access_control.access_levels.label of the strongest level.',
  permissions: 'Permission keys, written out.',
  permission_count: 'Number of permissions.',
  user_count: 'Number of people holding this role.',
  created_by: 'public.users.id of who created it.',
  created_at: 'When it was created.',
  updated_by: 'public.users.id of who last changed it.',
  updated_at: 'When it was last changed.',
  modified_by: 'public.users.id of who changed it away from the defaults.',
  granted_by: 'public.users.id of who gave this access.',
  granted_at: 'When this access was given.',
  assigned_by: 'public.users.id of who assigned it.',
  assigned_at: 'When it was assigned.',
};

const SCHEMA_DESCRIPTION = 'Who can do what: features, permissions, roles, and what each person and company has been given.';

const literal = (text: string) => `'${text.replace(/'/g, "''")}'`;

function commentStatements(columnsOf: (relation: string) => readonly string[]): string[] {
  return [
    `COMMENT ON SCHEMA ${S} IS ${literal(SCHEMA_DESCRIPTION)}`,
    ...Object.entries(DESCRIPTIONS).flatMap(([name, d]) => [
      `COMMENT ON ${d.kind} ${name} IS ${literal(d.about)}`,
      ...columnsOf(name)
        .filter((column) => d.columns[column] || COMMON_COLUMNS[column])
        .map((column) =>
          `COMMENT ON COLUMN ${name}.${quoteIdentifier(column)} IS ${literal(d.columns[column] || COMMON_COLUMNS[column])}`
        ),
    ]),
  ];
}

const DESCRIBED_RELATIONS = Object.keys(DESCRIPTIONS);

export { SCHEMA, TABLES, INDEXES, TRIGGERS, VIEWS, DESCRIBED_RELATIONS, commentStatements };
