import config from '../config';
import { T } from '../models/rbacModel';

const { db } = config.database;

async function permissionIds(userId: number): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT permission_ids FROM ${T.userPermissions} WHERE user_id = ?`,
    [userId]
  );
  return rows[0] ? rows[0].permission_ids : [];
}

async function replace(userId: number, ids: readonly string[], actorId: number | null): Promise<void> {
  if (!ids.length) {
    await db.query(`DELETE FROM ${T.userPermissions} WHERE user_id = ?`, [userId]);
    return;
  }
  await db.query(
    `INSERT INTO ${T.userPermissions} (user_id, permission_ids, updated_by)
     VALUES (?, ?::uuid[], ?)
     ON CONFLICT (user_id) DO UPDATE
       SET permission_ids = EXCLUDED.permission_ids, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [userId, ids, actorId]
  );
}

export { permissionIds, replace };
