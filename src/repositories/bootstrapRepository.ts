import config from '../config';
import { T, TABLES, INDEXES, INTEGRITY } from '../models/rbacModel';
import * as context from '../models/contextModel';

const { db } = config.database;

async function createRbacSchema(): Promise<void> {
  for (const ddl of TABLES) await db.raw(ddl);
  for (const ddl of INDEXES) await db.raw(ddl);
}

async function createRbacIntegrity(): Promise<void> {
  for (const ddl of INTEGRITY) await db.raw(ddl);
}

async function upsertPermissionCatalogue(
  rows: ReadonlyArray<{ id: string; feature: string | null; platformOnly: boolean; adminOnly: boolean }>
): Promise<void> {
  await db.query(
    `INSERT INTO ${T.permissions} (id, feature, platform_only, admin_only)
     SELECT * FROM unnest(?::text[], ?::text[], ?::boolean[], ?::boolean[])
     ON CONFLICT (id) DO UPDATE SET feature = EXCLUDED.feature,
       platform_only = EXCLUDED.platform_only, admin_only = EXCLUDED.admin_only`,
    [rows.map((r) => r.id), rows.map((r) => r.feature), rows.map((r) => r.platformOnly), rows.map((r) => r.adminOnly)]
  );
}

async function prunePermissionCatalogue(ids: readonly string[]): Promise<void> {
  await db.query(`DELETE FROM ${T.permissions} WHERE NOT (id = ANY(?::text[]))`, [ids]);
}

async function createContextSchema(): Promise<void> {
  for (const ddl of context.TABLES) await db.raw(ddl);
  for (const ddl of context.INDEXES) await db.raw(ddl);
  await db.raw(context.BACKFILL);
}

async function loggedPermissionIds(): Promise<string[]> {
  const { rows } = await db.query(`SELECT permission_id FROM ${T.permissionSeedLog}`);
  return rows.map((r) => r.permission_id);
}

async function heldPermissionIds(): Promise<string[]> {
  const { rows } = await db.query(`SELECT DISTINCT permission_id FROM ${T.rolePermissions}`);
  return rows.map((r) => r.permission_id);
}

async function upsertRole(role: { name: string; scope: string; description?: string | null }): Promise<boolean> {
  const { rows } = await db.query(
    `INSERT INTO ${T.roles} (name, scope, description) VALUES (?, ?, ?)
     ON CONFLICT (name) DO UPDATE SET scope = EXCLUDED.scope, description = EXCLUDED.description
     RETURNING (xmax = 0) AS inserted`,
    [role.name, role.scope, role.description]
  );
  return Boolean(rows[0] && rows[0].inserted);
}

async function grantRolePermission(roleName: string, permissionId: string): Promise<void> {
  await db.query(
    `INSERT INTO ${T.rolePermissions} (role_name, permission_id) VALUES (?, ?)
     ON CONFLICT DO NOTHING`,
    [roleName, permissionId]
  );
}

async function grantReplacements(retired: string, replacements: readonly string[]): Promise<number> {
  const result = await db.query(
    `INSERT INTO ${T.rolePermissions} (role_name, permission_id)
     SELECT rp.role_name, r FROM ${T.rolePermissions} rp, unnest(?::text[]) AS r
      WHERE rp.permission_id = ?
     ON CONFLICT DO NOTHING`,
    [replacements, retired]
  );
  return result.rowCount || 0;
}

async function claimRepair(id: string): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO ${T.rbacRepairs} (id) VALUES (?) ON CONFLICT DO NOTHING`,
    [id]
  );
  return (result.rowCount || 0) > 0;
}

async function logPermission(permissionId: string): Promise<void> {
  await db.query(
    `INSERT INTO ${T.permissionSeedLog} (permission_id) VALUES (?) ON CONFLICT DO NOTHING`,
    [permissionId]
  );
}

async function purgePermissionsNotIn(permissionIds: readonly string[]): Promise<number | null> {
  const result = await db.query(
    `DELETE FROM ${T.rolePermissions}
      WHERE permission_id NOT IN (${permissionIds.map(() => '?').join(',')})`,
    permissionIds
  );
  return result.rowCount;
}

async function rolesNotIn(roleNames: readonly string[]): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT name FROM ${T.roles} WHERE name NOT IN (${roleNames.map(() => '?').join(',')})`,
    roleNames
  );
  return rows.map((r) => r.name);
}

async function countUsersWithRole(roleName: string): Promise<number> {
  const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM ${T.users} WHERE role = ?`, [roleName]);
  return rows[0].n;
}

async function deleteRole(roleName: string): Promise<void> {
  await db.query(`DELETE FROM ${T.roles} WHERE name = ?`, [roleName]);
}

async function countUsers(): Promise<number> {
  const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM ${T.users}`);
  return rows[0].n;
}

async function insertSuperAdmin({ username, email, passwordHash, role }: {
  username: string;
  email: string;
  passwordHash: string;
  role: string;
}): Promise<void> {
  await db.query(
    `INSERT INTO ${T.users} (company_id, username, email, password_hash, role, status, must_change_password)
     VALUES (NULL, ?, ?, ?, ?, 'active', TRUE)`,
    [username, email, passwordHash, role]
  );
}

async function insertDashboardIfMissing({ id, title, description, spec }: {
  id: string;
  title: string;
  description?: string | null;
  spec: unknown;
}): Promise<void> {
  await db.query(
    `INSERT INTO ${T.dashboards} (id, title, description, company_id, created_by, spec)
     VALUES (?, ?, ?, NULL, NULL, ?)
     ON CONFLICT (id) DO NOTHING`,
    [id, title, description, JSON.stringify(spec)]
  );
}

export {
  createRbacSchema,
  createRbacIntegrity,
  upsertPermissionCatalogue,
  prunePermissionCatalogue,
  createContextSchema,
  loggedPermissionIds,
  heldPermissionIds,
  upsertRole,
  grantRolePermission,
  grantReplacements,
  claimRepair,
  logPermission,
  purgePermissionsNotIn,
  rolesNotIn,
  countUsersWithRole,
  deleteRole,
  countUsers,
  insertSuperAdmin,
  insertDashboardIfMissing,
};
