import config from '../config';
import { T } from '../models/rbacModel';
import type { Queryable } from '../config/pgPool';

const { db } = config.database;

const SYSTEM_COLUMNS = `r.id, r.tier, r.name, r.description,
  COALESCE(rp.permission_ids, '{}') AS "permissionIds", rp.updated_at AS "updatedAt"`;

async function findSystemRole(id: string) {
  const { rows } = await db.query(
    `SELECT ${SYSTEM_COLUMNS}
       FROM ${T.roles} r LEFT JOIN ${T.rolePermissions} rp ON rp.role_id = r.id
      WHERE r.id = ? AND r.kind = 'system'`,
    [id]
  );
  return rows[0] || null;
}

async function permissionIds(roleId: string, conn: Queryable = db): Promise<string[]> {
  const { rows } = await conn.query(
    `SELECT permission_ids FROM ${T.rolePermissions} WHERE role_id = ?`,
    [roleId]
  );
  return rows[0] ? rows[0].permission_ids : [];
}

async function listSystemWithCounts() {
  const { rows } = await db.query(
    `SELECT r.id, r.tier, r.name, r.description,
            (SELECT COUNT(*) FROM ${T.userRoles} ur JOIN ${T.roles} held ON held.id = ur.role_id
              WHERE held.tier = r.tier) AS "userCount"
       FROM ${T.roles} r
      WHERE r.kind = 'system'
      ORDER BY CASE r.tier WHEN 'SUPER_ADMIN' THEN 0 WHEN 'COMPANY_ADMIN' THEN 1 ELSE 2 END`
  );
  return rows;
}

async function replacePermissions(roleId: string, ids: readonly string[], actorId: number | null): Promise<void> {
  await db.query(
    `INSERT INTO ${T.rolePermissions} (role_id, permission_ids, updated_by)
     VALUES (?, ?::uuid[], ?)
     ON CONFLICT (role_id) DO UPDATE
       SET permission_ids = EXCLUDED.permission_ids, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [roleId, ids, actorId]
  );
}

export { findSystemRole, permissionIds, listSystemWithCounts, replacePermissions };
