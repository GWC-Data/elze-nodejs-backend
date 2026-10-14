import config from '../config';
import { ACCESS_SCHEMA, T, TABLES, INDEXES } from '../models/rbacModel';
import * as access from '../models/accessControlModel';
import * as context from '../models/contextModel';
import { quoteQualified } from '../tools/sql';
import type { Queryable } from '../config/pgPool';

const { db } = config.database;

async function runAll(statements: readonly string[], conn: Queryable = db): Promise<void> {
  for (const ddl of statements) await conn.raw(ddl);
}

async function createCoreSchema(): Promise<void> {
  await runAll(TABLES);
  await runAll(INDEXES);
}

async function createContextSchema(): Promise<void> {
  await runAll(context.TABLES);
  await runAll(context.INDEXES);
  await db.raw(context.BACKFILL);
}

async function createAccessControlSchema(conn: Queryable = db): Promise<void> {
  await runAll(access.SCHEMA, conn);
  await runAll(access.TABLES, conn);
  await runAll(access.INDEXES, conn);
  await runAll(access.TRIGGERS, conn);
}

async function createAccessControlViews(conn: Queryable = db): Promise<void> {
  await runAll(access.VIEWS, conn);
  const { rows } = await conn.query(
    `SELECT table_name, array_agg(column_name::text ORDER BY ordinal_position) AS columns
       FROM information_schema.columns WHERE table_schema = ? GROUP BY table_name`,
    [ACCESS_SCHEMA]
  );
  const byRelation = new Map<string, string[]>(
    rows.map((r) => [quoteQualified(ACCESS_SCHEMA, r.table_name), r.columns])
  );
  await runAll(access.commentStatements((relation) => byRelation.get(relation) || []), conn);
}

async function upsertFeatures(
  rows: ReadonlyArray<{ id: string; key: string; label: string; description: string; locked: boolean; covers: string[] }>,
  conn: Queryable = db
): Promise<void> {
  for (const [index, f] of rows.entries()) {
    await conn.query(
      `INSERT INTO ${T.features} AS cur (id, key, label, description, locked, covers, sort_order)
       VALUES (?, ?, ?, ?, ?, ?::text[], ?)
       ON CONFLICT (id) DO UPDATE SET key = EXCLUDED.key, label = EXCLUDED.label,
         description = EXCLUDED.description, locked = EXCLUDED.locked, covers = EXCLUDED.covers,
         sort_order = EXCLUDED.sort_order, updated_at = now()
       WHERE (cur.key, cur.label, cur.description, cur.locked,
              cur.covers, cur.sort_order)
             IS DISTINCT FROM (EXCLUDED.key, EXCLUDED.label, EXCLUDED.description, EXCLUDED.locked,
              EXCLUDED.covers, EXCLUDED.sort_order)`,
      [f.id, f.key, f.label, f.description, f.locked, f.covers, index]
    );
  }
}

async function upsertPermissions(
  rows: ReadonlyArray<{
    id: string;
    key: string;
    label: string;
    description: string;
    featureId: string | null;
    platformOnly: boolean;
    adminOnly: boolean;
  }>,
  conn: Queryable = db
): Promise<void> {
  for (const [index, p] of rows.entries()) {
    await conn.query(
      `INSERT INTO ${T.permissions} AS cur (id, key, label, description, feature_id, platform_only, admin_only, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET key = EXCLUDED.key, label = EXCLUDED.label,
         description = EXCLUDED.description, feature_id = EXCLUDED.feature_id,
         platform_only = EXCLUDED.platform_only, admin_only = EXCLUDED.admin_only,
         sort_order = EXCLUDED.sort_order, updated_at = now()
       WHERE (cur.key, cur.label, cur.description, cur.feature_id,
              cur.platform_only, cur.admin_only, cur.sort_order)
             IS DISTINCT FROM (EXCLUDED.key, EXCLUDED.label, EXCLUDED.description, EXCLUDED.feature_id,
              EXCLUDED.platform_only, EXCLUDED.admin_only, EXCLUDED.sort_order)`,
      [p.id, p.key, p.label, p.description, p.featureId, p.platformOnly, p.adminOnly, index]
    );
  }
}

async function upsertAccessLevels(
  rows: ReadonlyArray<{ id: string; resource: string; key: string; rank: number; label: string; description: string }>,
  conn: Queryable = db
): Promise<void> {
  for (const l of rows) {
    await conn.query(
      `INSERT INTO ${T.accessLevels} (id, resource, key, rank, label, description)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET resource = EXCLUDED.resource, key = EXCLUDED.key, rank = EXCLUDED.rank,
         label = EXCLUDED.label, description = EXCLUDED.description`,
      [l.id, l.resource, l.key, l.rank, l.label, l.description]
    );
  }
}

async function pruneCatalogue({ permissionIds, featureIds, accessLevelIds }: {
  permissionIds: readonly string[];
  featureIds: readonly string[];
  accessLevelIds: readonly string[];
}): Promise<{ permissions: number; features: number }> {
  const permissions = await db.query(
    `DELETE FROM ${T.permissions} WHERE NOT (id = ANY(?::uuid[]))`,
    [permissionIds]
  );
  const features = await db.query(`DELETE FROM ${T.features} WHERE NOT (id = ANY(?::uuid[]))`, [featureIds]);
  await db.query(`DELETE FROM ${T.accessLevels} WHERE NOT (id = ANY(?::uuid[]))`, [accessLevelIds]);
  return { permissions: permissions.rowCount || 0, features: features.rowCount || 0 };
}

async function upsertSystemRole(
  role: { id: string; tier: string; name: string; description: string },
  conn: Queryable = db
): Promise<boolean> {
  const { rows } = await conn.query(
    `INSERT INTO ${T.roles} (id, company_id, kind, tier, name, description)
     VALUES (?, NULL, 'system', ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET tier = EXCLUDED.tier, name = EXCLUDED.name, description = EXCLUDED.description
     RETURNING (xmax = 0) AS inserted`,
    [role.id, role.tier, role.name, role.description]
  );
  return Boolean(rows[0] && rows[0].inserted);
}

async function unknownSystemRoles(roleIds: readonly string[]): Promise<Array<{ id: string; name: string; holders: number }>> {
  const { rows } = await db.query(
    `SELECT r.id, r.name, (SELECT COUNT(*)::int FROM ${T.userRoles} ur WHERE ur.role_id = r.id) AS holders
       FROM ${T.roles} r WHERE r.kind = 'system' AND NOT (r.id = ANY(?::uuid[]))`,
    [roleIds]
  );
  return rows;
}

async function deleteRole(roleId: string): Promise<void> {
  await db.query(`DELETE FROM ${T.roles} WHERE id = ?`, [roleId]);
}

async function newPermissionIds(): Promise<string[]> {
  const { rows } = await db.query(`SELECT id FROM ${T.permissions} WHERE defaults_applied_at IS NULL`);
  return rows.map((r) => r.id);
}

async function markDefaultsApplied(): Promise<void> {
  await db.query(`UPDATE ${T.permissions} SET defaults_applied_at = now() WHERE defaults_applied_at IS NULL`);
}

async function addRolePermissions(roleId: string, permissionIds: readonly string[], conn: Queryable = db): Promise<number> {
  if (!permissionIds.length) return 0;
  const { rows } = await conn.query(
    `INSERT INTO ${T.rolePermissions} AS rp (role_id, permission_ids)
     VALUES (?, ?::uuid[])
     ON CONFLICT (role_id) DO UPDATE
       SET permission_ids = ARRAY(SELECT DISTINCT unnest(rp.permission_ids || EXCLUDED.permission_ids)),
           updated_at = now()
       WHERE NOT (rp.permission_ids @> EXCLUDED.permission_ids)
     RETURNING role_id`,
    [roleId, permissionIds]
  );
  return rows.length;
}

async function setRolePermissions(roleId: string, permissionIds: readonly string[], conn: Queryable = db): Promise<void> {
  await conn.query(
    `INSERT INTO ${T.rolePermissions} AS rp (role_id, permission_ids)
     VALUES (?, ?::uuid[])
     ON CONFLICT (role_id) DO UPDATE SET permission_ids = EXCLUDED.permission_ids, updated_at = now()
       WHERE NOT (rp.permission_ids @> EXCLUDED.permission_ids AND rp.permission_ids <@ EXCLUDED.permission_ids)`,
    [roleId, permissionIds]
  );
}

async function grantReplacements(retiredKey: string, replacementIds: readonly string[]): Promise<number> {
  let changed = 0;
  for (const table of [T.rolePermissions, T.userPermissions]) {
    const result = await db.query(
      `UPDATE ${table} t
          SET permission_ids = ARRAY(SELECT DISTINCT unnest(t.permission_ids || ?::uuid[])), updated_at = now()
        WHERE (SELECT p.id FROM ${T.permissions} p WHERE p.key = ?) = ANY(t.permission_ids)`,
      [replacementIds, retiredKey]
    );
    changed += result.rowCount || 0;
  }
  return changed;
}

async function claimRepair(id: string, conn: Queryable = db): Promise<boolean> {
  const result = await conn.query(
    `INSERT INTO ${T.rbacRepairs} (id) VALUES (?) ON CONFLICT DO NOTHING`,
    [id]
  );
  return (result.rowCount || 0) > 0;
}

async function countUsers(): Promise<number> {
  const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM ${T.users}`);
  return rows[0].n;
}

async function countUsersWithoutRole(): Promise<number> {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM ${T.users} u
      WHERE NOT EXISTS (SELECT 1 FROM ${T.userRoles} ur WHERE ur.user_id = u.id)`
  );
  return rows[0].n;
}

async function insertSuperAdmin({ username, email, passwordHash, roleId }: {
  username: string;
  email: string;
  passwordHash: string;
  roleId: string;
}): Promise<void> {
  await db.transaction(async (conn: Queryable) => {
    const { rows } = await conn.query(
      `INSERT INTO ${T.users} (company_id, username, email, password_hash, status, must_change_password)
       VALUES (NULL, ?, ?, ?, 'active', TRUE) RETURNING id`,
      [username, email, passwordHash]
    );
    await conn.query(`INSERT INTO ${T.userRoles} (user_id, role_id) VALUES (?, ?)`, [rows[0].id, roleId]);
  });
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
  createCoreSchema,
  createContextSchema,
  createAccessControlSchema,
  createAccessControlViews,
  upsertFeatures,
  upsertPermissions,
  upsertAccessLevels,
  pruneCatalogue,
  upsertSystemRole,
  unknownSystemRoles,
  deleteRole,
  newPermissionIds,
  markDefaultsApplied,
  addRolePermissions,
  setRolePermissions,
  grantReplacements,
  claimRepair,
  countUsers,
  countUsersWithoutRole,
  insertSuperAdmin,
  insertDashboardIfMissing,
};
