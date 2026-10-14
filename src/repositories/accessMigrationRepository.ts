import { LEGACY_SCHEMA, T, V } from '../models/rbacModel';
import { quoteIdentifier } from '../tools/sql';
import type { Queryable } from '../config/pgPool';

const q = quoteIdentifier;
const LS = q(LEGACY_SCHEMA);

const L = {
  roles: q('roles'),
  rolePermissions: q('role_permissions'),
  permissions: q('permissions'),
  permissionSeedLog: q('permission_seed_log'),
  companyFeatures: q('company_features'),
  companyRoles: q('company_roles'),
  companyRolePermissions: q('company_role_permissions'),
  userDataScope: q('user_data_scope'),
  companyDashboards: q('company_dashboards'),
  dashboardAccess: q('dashboard_access'),
  groupDashboardAccess: q('group_dashboard_access'),
  contextAccess: q('context_access'),
  contextGroupAccess: q('context_group_access'),
};

const MIGRATION_LOCK = 724519001;

async function lock(conn: Queryable): Promise<void> {
  await conn.query(`SELECT pg_advisory_xact_lock(?)`, [MIGRATION_LOCK]);
}

async function exists(conn: Queryable, relation: string): Promise<boolean> {
  const { rows } = await conn.query(`SELECT to_regclass(?) IS NOT NULL AS found`, [relation]);
  return Boolean(rows[0] && rows[0].found);
}

async function hasColumn(conn: Queryable, table: string, column: string): Promise<boolean> {
  const { rows } = await conn.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?
     ) AS found`,
    [table, column]
  );
  return Boolean(rows[0] && rows[0].found);
}

async function needsMigration(conn: Queryable): Promise<boolean> {
  return (await exists(conn, 'role_permissions')) && (await hasColumn(conn, 'users', 'role'));
}

async function legacyUsers(conn: Queryable) {
  const { rows } = await conn.query(`SELECT id, company_id, role, custom_role_id FROM ${T.users} ORDER BY id`);
  return rows as Array<{ id: number; company_id: number | null; role: string; custom_role_id: number | null }>;
}

async function legacyRolePermissions(conn: Queryable): Promise<Map<string, string[]>> {
  const { rows } = await conn.query(
    `SELECT role_name, array_agg(permission_id ORDER BY permission_id) AS keys FROM ${L.rolePermissions} GROUP BY role_name`
  );
  return new Map(rows.map((r) => [r.role_name, r.keys]));
}

async function legacyCompanyRoles(conn: Queryable) {
  if (!(await exists(conn, 'company_roles'))) return [];
  const { rows } = await conn.query(
    `SELECT r.id, r.company_id, r.name, r.description, r.builtin_role,
            (SELECT u.id FROM ${T.users} u WHERE u.id = r.created_by) AS created_by,
            r.created_at, r.updated_at,
            (SELECT u.id FROM ${T.users} u WHERE u.id = r.modified_by) AS modified_by,
            r.modified_at,
            COALESCE((SELECT array_agg(p.permission_id ORDER BY p.permission_id)
                        FROM ${L.companyRolePermissions} p WHERE p.role_id = r.id), '{}') AS keys
       FROM ${L.companyRoles} r
      ORDER BY r.id`
  );
  return rows;
}

async function legacyCompanyFeatures(conn: Queryable) {
  const seeded = (await hasColumn(conn, 'companies', 'features_seeded')) ? 'c.features_seeded' : 'TRUE';
  const { rows } = await conn.query(
    `SELECT c.id, ${seeded} AS seeded,
            COALESCE((SELECT array_agg(f.feature_id ORDER BY f.feature_id)
                        FROM ${L.companyFeatures} f WHERE f.company_id = c.id), '{}') AS keys
       FROM ${T.companies} c ORDER BY c.id`
  );
  return rows as Array<{ id: number; seeded: boolean; keys: string[] }>;
}

async function knownPermissionKeys(conn: Queryable): Promise<string[]> {
  const parts = [`SELECT permission_id FROM ${L.rolePermissions}`];
  if (await exists(conn, 'permission_seed_log')) parts.push(`SELECT permission_id FROM ${L.permissionSeedLog}`);
  if (await exists(conn, 'company_role_permissions')) parts.push(`SELECT permission_id FROM ${L.companyRolePermissions}`);
  const { rows } = await conn.query(`SELECT DISTINCT permission_id FROM (${parts.join(' UNION ')}) known`);
  return rows.map((r) => r.permission_id);
}

async function insertRole(conn: Queryable, row: {
  id: string;
  companyId: number;
  kind: string;
  name: string;
  description: string | null;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
  modifiedBy: number | null;
  modifiedAt: Date | null;
}): Promise<void> {
  await conn.query(
    `INSERT INTO ${T.roles}
       (id, company_id, kind, tier, name, description, created_by, created_at, updated_at, modified_by, modified_at)
     VALUES (?, ?, ?, 'USER', ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.companyId, row.kind, row.name, row.description, row.createdBy, row.createdAt, row.updatedAt,
      row.modifiedBy, row.modifiedAt]
  );
}

async function setRolePermissions(conn: Queryable, roleId: string, ids: readonly string[]): Promise<void> {
  await conn.query(
    `INSERT INTO ${T.rolePermissions} (role_id, permission_ids) VALUES (?, ?::uuid[])
     ON CONFLICT (role_id) DO UPDATE SET permission_ids = EXCLUDED.permission_ids, updated_at = now()`,
    [roleId, ids]
  );
}

async function insertCompanyFeatures(conn: Queryable, companyId: number, ids: readonly string[]): Promise<void> {
  await conn.query(
    `INSERT INTO ${T.companyFeatures} (company_id, feature_ids) VALUES (?, ?::uuid[])`,
    [companyId, ids]
  );
}

async function insertUserRole(conn: Queryable, userId: number, roleId: string): Promise<void> {
  await conn.query(`INSERT INTO ${T.userRoles} (user_id, role_id) VALUES (?, ?)`, [userId, roleId]);
}

async function copyDataScopes(conn: Queryable): Promise<number> {
  if (!(await exists(conn, 'user_data_scope'))) return 0;
  const result = await conn.query(
    `INSERT INTO ${T.userDataScopes} (user_id, scopes)
     SELECT user_id, jsonb_object_agg(dimension, to_jsonb(vals))
       FROM (SELECT user_id, dimension, array_agg(value ORDER BY value) AS vals
               FROM ${L.userDataScope} GROUP BY user_id, dimension) per_dimension
      GROUP BY user_id`
  );
  return result.rowCount || 0;
}

const GRANTOR = (column: string) => `(SELECT gu.id FROM ${T.users} gu WHERE gu.id = ${column})`;

async function copyGrants(conn: Queryable): Promise<Record<string, { legacy: number; copied: number }>> {
  const out: Record<string, { legacy: number; copied: number }> = {};
  const copy = async (name: string, legacyTable: string, sql: string) => {
    if (!(await exists(conn, name))) return;
    const { rows } = await conn.query(`SELECT COUNT(*)::int AS n FROM ${legacyTable}`);
    const result = await conn.query(sql);
    out[name] = { legacy: rows[0].n, copied: result.rowCount || 0 };
  };

  await copy('company_dashboards', L.companyDashboards,
    `INSERT INTO ${T.companyDashboards} (company_id, dashboard_id, assigned_by, assigned_at)
     SELECT x.company_id, x.dashboard_id, ${GRANTOR('x.assigned_by')}, x.assigned_at
       FROM ${L.companyDashboards} x
      WHERE EXISTS (SELECT 1 FROM ${T.dashboards} d WHERE d.id = x.dashboard_id)`);

  await copy('dashboard_access', L.dashboardAccess,
    `INSERT INTO ${T.dashboardUserAccess} (user_id, dashboard_id, access_level_id, granted_by, granted_at)
     SELECT x.user_id, x.dashboard_id, l.id, ${GRANTOR('x.granted_by')}, x.granted_at
       FROM ${L.dashboardAccess} x
       JOIN ${T.accessLevels} l ON l.resource = 'dashboard' AND l.key = x.access_level
      WHERE EXISTS (SELECT 1 FROM ${T.dashboards} d WHERE d.id = x.dashboard_id)`);

  await copy('group_dashboard_access', L.groupDashboardAccess,
    `INSERT INTO ${T.dashboardGroupAccess} (group_id, dashboard_id, access_level_id, granted_by, granted_at)
     SELECT x.group_id, x.dashboard_id, l.id, ${GRANTOR('x.granted_by')}, x.granted_at
       FROM ${L.groupDashboardAccess} x
       JOIN ${T.accessLevels} l ON l.resource = 'dashboard' AND l.key = x.access_level
      WHERE EXISTS (SELECT 1 FROM ${T.dashboards} d WHERE d.id = x.dashboard_id)`);

  await copy('context_access', L.contextAccess,
    `INSERT INTO ${T.contextUserAccess} (connection_id, user_id, access_level_id, granted_by, granted_at)
     SELECT x.connection_id, x.user_id, l.id, ${GRANTOR('x.granted_by')}, x.granted_at
       FROM ${L.contextAccess} x
       JOIN ${T.accessLevels} l ON l.resource = 'context' AND l.key = x.access_level`);

  await copy('context_group_access', L.contextGroupAccess,
    `INSERT INTO ${T.contextGroupAccess} (connection_id, group_id, access_level_id, granted_by, granted_at)
     SELECT x.connection_id, x.group_id, l.id, ${GRANTOR('x.granted_by')}, x.granted_at
       FROM ${L.contextGroupAccess} x
       JOIN ${T.accessLevels} l ON l.resource = 'context' AND l.key = x.access_level`);

  return out;
}

async function markDefaultsApplied(conn: Queryable, keys: readonly string[]): Promise<void> {
  await conn.query(
    `UPDATE ${T.permissions} SET defaults_applied_at = now() WHERE key = ANY(?::text[])`,
    [keys]
  );
}

async function effectiveAccess(conn: Queryable) {
  const { rows } = await conn.query(
    `SELECT u.id, u.company_id, r.tier AS role,
            COALESCE((SELECT array_agg(e.permission_key ORDER BY e.permission_key)
                        FROM ${V.userEffectivePermissions} e
                       WHERE e.user_id = u.id AND e.is_effective), '{}') AS permissions,
            COALESCE((SELECT cf.feature_ids FROM ${T.companyFeatures} cf WHERE cf.company_id = u.company_id), '{}')
              AS feature_ids
       FROM ${T.users} u
       LEFT JOIN ${T.userRoles} ur ON ur.user_id = u.id
       LEFT JOIN ${T.roles} r ON r.id = ur.role_id
      ORDER BY u.id`
  );
  return rows as Array<{ id: number; company_id: number | null; role: string | null; permissions: string[]; feature_ids: string[] }>;
}

async function retireLegacyTables(conn: Queryable, roleMap: ReadonlyArray<[number, string]>): Promise<string[]> {
  await conn.raw(`CREATE SCHEMA IF NOT EXISTS ${LS}`);
  await conn.raw(
    `COMMENT ON SCHEMA ${LS} IS 'Old role and permission tables, kept unchanged after the move to access_control. Safe to drop once the new tables are verified.'`
  );

  await conn.raw(`DROP TRIGGER IF EXISTS trg_users_custom_role_guard ON ${T.users}`);
  await conn.raw(`DROP FUNCTION IF EXISTS rbac_forbid_builtin_custom_role()`);
  if (await exists(conn, 'company_role_permissions')) {
    await conn.raw(`DROP TRIGGER IF EXISTS trg_company_role_permission_guard ON ${L.companyRolePermissions}`);
  }
  await conn.raw(`DROP FUNCTION IF EXISTS rbac_guard_company_role_permission()`);

  await conn.raw(
    `CREATE TABLE ${LS}.user_roles_snapshot AS
     SELECT id AS user_id, company_id, role, custom_role_id FROM ${T.users}`
  );
  await conn.raw(`CREATE TABLE ${LS}.role_id_map (legacy_role_id INTEGER PRIMARY KEY, role_id UUID NOT NULL)`);
  for (const [legacyId, roleId] of roleMap) {
    await conn.query(`INSERT INTO ${LS}.role_id_map (legacy_role_id, role_id) VALUES (?, ?)`, [legacyId, roleId]);
  }
  if (await hasColumn(conn, 'companies', 'features_seeded')) {
    await conn.raw(
      `CREATE TABLE ${LS}.company_features_seeded AS SELECT id AS company_id, features_seeded FROM ${T.companies}`
    );
  }

  const moved: string[] = [];
  for (const [name, relation] of Object.entries({
    role_permissions: L.rolePermissions,
    company_role_permissions: L.companyRolePermissions,
    company_roles: L.companyRoles,
    roles: L.roles,
    permission_seed_log: L.permissionSeedLog,
    permissions: L.permissions,
    company_features: L.companyFeatures,
    user_data_scope: L.userDataScope,
    company_dashboards: L.companyDashboards,
    dashboard_access: L.dashboardAccess,
    group_dashboard_access: L.groupDashboardAccess,
    context_access: L.contextAccess,
    context_group_access: L.contextGroupAccess,
  })) {
    if (!(await exists(conn, name))) continue;
    await conn.raw(`ALTER TABLE ${relation} SET SCHEMA ${LS}`);
    moved.push(name);
  }

  await conn.raw(`ALTER TABLE ${T.users} DROP COLUMN IF EXISTS custom_role_id`);
  await conn.raw(`ALTER TABLE ${T.users} DROP COLUMN IF EXISTS role`);
  await conn.raw(`ALTER TABLE ${T.companies} DROP COLUMN IF EXISTS features_seeded`);
  return moved;
}

export {
  lock,
  needsMigration,
  legacyUsers,
  legacyRolePermissions,
  legacyCompanyRoles,
  legacyCompanyFeatures,
  knownPermissionKeys,
  insertRole,
  setRolePermissions,
  insertCompanyFeatures,
  insertUserRole,
  copyDataScopes,
  copyGrants,
  markDefaultsApplied,
  effectiveAccess,
  retireLegacyTables,
};
