import config from '../config';
import { T } from '../models/rbac.model';
import type { Queryable } from '../config/pgPool';

const { db, withTransaction } = config.database;

async function findByName(name: string) {
  const { rows } = await db.query(
    `SELECT id, name, scope, description FROM ${T.roles} WHERE name = ?`,
    [name]
  );
  return rows[0] || null;
}

async function permissionIds(roleName: string, { ordered = false }: { ordered?: boolean } = {}): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT permission_id FROM ${T.rolePermissions} WHERE role_name = ?${ordered ? ' ORDER BY permission_id' : ''}`,
    [roleName]
  );
  return rows.map((r) => r.permission_id);
}

async function listWithCounts() {
  const { rows } = await db.query(
    `SELECT r.name, r.scope, r.description,
            (SELECT COUNT(*) FROM ${T.users} u WHERE u.role = r.name) AS "userCount"
       FROM ${T.roles} r
      ORDER BY CASE r.scope WHEN 'platform' THEN 0 ELSE 1 END, r.name`
  );
  return rows;
}

async function replacePermissions(roleName: string, permissions: readonly string[]): Promise<void> {
  await withTransaction(async (conn: Queryable) => {
    await conn.query(`DELETE FROM ${T.rolePermissions} WHERE role_name = ?`, [roleName]);
    if (permissions.length) {
      const placeholders = permissions.map(() => '(?, ?)').join(', ');
      await conn.query(
        `INSERT INTO ${T.rolePermissions} (role_name, permission_id) VALUES ${placeholders}`,
        permissions.flatMap((id) => [roleName, id])
      );
    }
  });
}

export { findByName, permissionIds, listWithCounts, replacePermissions };
