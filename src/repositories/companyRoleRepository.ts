import crypto from 'crypto';
import config from '../config';
import { T } from '../models/rbacModel';
import type { Queryable } from '../config/pgPool';

const { db, withTransaction } = config.database;

const COMPANY_DEFAULT_NAME = 'Member';

const ROLE_COLUMNS = `r.id, r.company_id AS "companyId", r.kind, r.tier, r.name, r.description,
                      r.created_at AS "createdAt", r.updated_at AS "updatedAt",
                      r.modified_at AS "modifiedAt",
                      (SELECT mu.username FROM ${T.users} mu WHERE mu.id = r.modified_by) AS "modifiedBy",
                      COALESCE((SELECT rp.permission_ids FROM ${T.rolePermissions} rp WHERE rp.role_id = r.id), '{}')
                        AS "permissionIds",
                      (SELECT COUNT(*) FROM ${T.userRoles} ur WHERE ur.role_id = r.id) AS "userCount"`;

async function writePermissions(conn: Queryable, roleId: string, ids: readonly string[], actorId: number | null) {
  await conn.query(
    `INSERT INTO ${T.rolePermissions} (role_id, permission_ids, updated_by)
     VALUES (?, ?::uuid[], ?)
     ON CONFLICT (role_id) DO UPDATE
       SET permission_ids = EXCLUDED.permission_ids, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [roleId, ids, actorId]
  );
}

async function listForCompany(companyId: number) {
  const { rows } = await db.query(
    `SELECT ${ROLE_COLUMNS} FROM ${T.roles} r
      WHERE r.company_id = ? AND r.kind = 'custom'
      ORDER BY lower(r.name), r.created_at`,
    [companyId]
  );
  return rows;
}

async function builtInCounts(companyId: number): Promise<Record<string, number>> {
  const { rows } = await db.query(
    `SELECT r.tier, COUNT(*) AS n
       FROM ${T.users} u
       JOIN ${T.userRoles} ur ON ur.user_id = u.id
       JOIN ${T.roles} r ON r.id = ur.role_id
      WHERE u.company_id = ? AND r.kind <> 'custom'
      GROUP BY r.tier`,
    [companyId]
  );
  return Object.fromEntries(rows.map((r) => [r.tier, Number(r.n)]));
}

async function findInCompany(id: string, companyId: number | null) {
  const { rows } = await db.query(
    `SELECT ${ROLE_COLUMNS} FROM ${T.roles} r
      WHERE r.id = ? AND r.kind = 'custom'${companyId === null ? '' : ' AND r.company_id = ?'}`,
    companyId === null ? [id] : [id, companyId]
  );
  return rows[0] || null;
}

async function insert(
  { companyId, name, description, permissionIds, createdBy }: {
    companyId: number;
    name: string;
    description: string | null;
    permissionIds: readonly string[];
    createdBy: number;
  }
): Promise<string> {
  return withTransaction(async (conn: Queryable) => {
    const id = crypto.randomUUID();
    await conn.query(
      `INSERT INTO ${T.roles} (id, company_id, kind, tier, name, description, created_by)
       VALUES (?, ?, 'custom', 'USER', ?, ?, ?)`,
      [id, companyId, name, description, createdBy]
    );
    await writePermissions(conn, id, permissionIds, createdBy);
    return id;
  });
}

async function update(
  id: string,
  { name, description, permissionIds }: { name?: string; description?: string | null; permissionIds?: readonly string[] },
  actorId: number
): Promise<void> {
  await withTransaction(async (conn: Queryable) => {
    const sets: string[] = ['updated_at = now()', 'modified_at = now()', 'modified_by = ?'];
    const params: unknown[] = [actorId];
    if (name !== undefined) { sets.push('name = ?'); params.push(name); }
    if (description !== undefined) { sets.push('description = ?'); params.push(description); }
    await conn.query(`UPDATE ${T.roles} SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    if (permissionIds !== undefined) await writePermissions(conn, id, permissionIds, actorId);
  });
}

async function findCompanyDefault(companyId: number, conn: Queryable = db) {
  const { rows } = await conn.query(
    `SELECT ${ROLE_COLUMNS} FROM ${T.roles} r
      WHERE r.company_id = ? AND r.kind = 'company_default' AND r.tier = 'USER'`,
    [companyId]
  );
  return rows[0] || null;
}

async function ensureCompanyDefault(conn: Queryable, companyId: number, actorId: number | null) {
  const { rows } = await conn.query(
    `INSERT INTO ${T.roles} (id, company_id, kind, tier, name, created_by)
     VALUES (?, ?, 'company_default', 'USER', ?, ?)
     ON CONFLICT (company_id, tier) WHERE kind = 'company_default'
       DO UPDATE SET updated_at = now()
     RETURNING id, (xmax = 0) AS inserted`,
    [crypto.randomUUID(), companyId, COMPANY_DEFAULT_NAME, actorId]
  );
  return rows[0] as { id: string; inserted: boolean };
}

async function seedCompanyDefault(companyId: number, permissionIds: readonly string[], conn?: Queryable): Promise<boolean> {
  const work = async (client: Queryable) => {
    const row = await ensureCompanyDefault(client, companyId, null);
    if (row.inserted) await writePermissions(client, row.id, permissionIds, null);
    return row.inserted;
  };
  return conn ? work(conn) : withTransaction(work);
}

async function saveCompanyDefault(companyId: number, permissionIds: readonly string[], actorId: number): Promise<void> {
  await withTransaction(async (conn: Queryable) => {
    const row = await ensureCompanyDefault(conn, companyId, actorId);
    await conn.query(
      `UPDATE ${T.roles} SET modified_by = ?, modified_at = now(), updated_at = now() WHERE id = ?`,
      [actorId, row.id]
    );
    await writePermissions(conn, row.id, permissionIds, actorId);
  });
}

async function resetCompanyDefault(companyId: number, permissionIds: readonly string[], actorId: number): Promise<boolean> {
  return withTransaction(async (conn: Queryable) => {
    const row = await ensureCompanyDefault(conn, companyId, null);
    const { rows } = await conn.query(`SELECT modified_at FROM ${T.roles} WHERE id = ?`, [row.id]);
    await conn.query(
      `UPDATE ${T.roles} SET modified_by = NULL, modified_at = NULL, updated_at = now() WHERE id = ?`,
      [row.id]
    );
    await writePermissions(conn, row.id, permissionIds, actorId);
    return Boolean(rows[0] && rows[0].modified_at);
  });
}

async function syncUnmodifiedCompanyDefaults(permissionIds: readonly string[]): Promise<number> {
  return withTransaction(async (conn: Queryable) => {
    await conn.query(
      `INSERT INTO ${T.rolePermissions} AS rp (role_id, permission_ids)
       SELECT r.id, ?::uuid[] FROM ${T.roles} r
        WHERE r.kind = 'company_default' AND r.tier = 'USER' AND r.modified_at IS NULL
       ON CONFLICT (role_id) DO UPDATE SET permission_ids = EXCLUDED.permission_ids, updated_at = now()
         WHERE NOT (rp.permission_ids @> EXCLUDED.permission_ids AND rp.permission_ids <@ EXCLUDED.permission_ids)`,
      [permissionIds]
    );
    const { rows } = await conn.query(
      `SELECT COUNT(*)::int AS n FROM ${T.roles}
        WHERE kind = 'company_default' AND tier = 'USER' AND modified_at IS NULL`
    );
    return rows[0].n;
  });
}

async function remove(id: string): Promise<boolean> {
  const result = await db.query(`DELETE FROM ${T.roles} WHERE id = ? AND kind = 'custom'`, [id]);
  return result.rowCount! > 0;
}

export {
  COMPANY_DEFAULT_NAME,
  listForCompany,
  builtInCounts,
  findInCompany,
  insert,
  update,
  remove,
  findCompanyDefault,
  seedCompanyDefault,
  saveCompanyDefault,
  resetCompanyDefault,
  syncUnmodifiedCompanyDefaults,
};
