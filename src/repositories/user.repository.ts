import config from '../config';
import { T } from '../models/rbac.model';
import { USER } from '../constants/permissions';
import { pagedRows, companyScope } from './base.repository';
import { orderBy } from '../tools/listQuery';
import type { Queryable } from '../config/pgPool';
import type { Actor } from '../types/actor';
import type { ListWindow } from './base.repository';

const { db } = config.database;

const USER_COLUMNS = `u.id, u.company_id, u.username, u.email, u.display_name,
                      (u.password_hash IS NOT NULL) AS has_password,
                      u.role, u.custom_role_id, u.status, u.must_change_password,
                      u.last_login_at, u.created_at`;

const USER_SORTS: Record<string, string> = {
  name: 'lower(COALESCE(u.display_name, u.username))',
  company: 'lower(c.name)',
  role: 'u.role',
  status: 'u.status',
  lastLogin: 'u.last_login_at',
};

async function findByIdentifier(value: string) {
  const { rows } = await db.query(
    `SELECT ${USER_COLUMNS}, u.password_hash,
            c.active AS "companyActive", c.name AS "companyName"
       FROM ${T.users} u
       LEFT JOIN ${T.companies} c ON c.id = u.company_id
      WHERE u.username = ? OR u.email = ?`,
    [value, value.toLowerCase()]
  );
  return rows[0] || null;
}

async function findCredentialsById(id: number) {
  const { rows } = await db.query(`SELECT password_hash FROM ${T.users} WHERE id = ?`, [id]);
  return rows[0] || null;
}

async function findActorRow(id: number) {
  const { rows } = await db.query(
    // Still ONE statement (see ARCHITECTURE §2.1). A member with a custom role takes that
    // role's permissions instead of USER's; the company's features come along so the
    // caller can mask them without a second round trip.
    `SELECT ${USER_COLUMNS}, c.active AS "companyActive", c.name AS "companyName",
            cr.name AS "customRoleName",
            COALESCE(CASE
                       WHEN u.custom_role_id IS NOT NULL AND u.role = ?
                         THEN (SELECT array_agg(crp.permission_id) FROM ${T.companyRolePermissions} crp
                                WHERE crp.role_id = u.custom_role_id)
                       -- the company's own version of the built-in Member role, if it made one
                       WHEN u.role = ? AND ob.id IS NOT NULL
                         THEN (SELECT array_agg(crp.permission_id) FROM ${T.companyRolePermissions} crp
                                WHERE crp.role_id = ob.id)
                       ELSE (SELECT array_agg(rp.permission_id) FROM ${T.rolePermissions} rp
                              WHERE rp.role_name = u.role)
                     END, '{}') AS permissions,
            COALESCE((SELECT array_agg(f.feature_id) FROM ${T.companyFeatures} f
                       WHERE f.company_id = u.company_id), '{}') AS features,
            COALESCE((SELECT json_agg(json_build_array(s.dimension, s.value)
                                      ORDER BY s.dimension, s.value)
                        FROM ${T.userDataScope} s WHERE s.user_id = u.id), '[]') AS scopes
       FROM ${T.users} u
       LEFT JOIN ${T.companies} c ON c.id = u.company_id
       LEFT JOIN ${T.companyRoles} cr ON cr.id = u.custom_role_id
       LEFT JOIN ${T.companyRoles} ob ON ob.company_id = u.company_id AND ob.builtin_role = u.role
      WHERE u.id = ?`,
    [USER, USER, id]
  );
  return rows[0] || null;
}

async function findById(id: number, conn?: Queryable) {
  const client = conn || db;
  const { rows } = await client.query(
    `SELECT ${USER_COLUMNS}, c.active AS "companyActive", c.name AS "companyName",
            cr.name AS "customRoleName"
       FROM ${T.users} u
       LEFT JOIN ${T.companies} c ON c.id = u.company_id
       LEFT JOIN ${T.companyRoles} cr ON cr.id = u.custom_role_id
      WHERE u.id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function findInScope(actor: Actor, id: unknown) {
  const scope = companyScope(actor, 'u.company_id');
  const { rows } = await db.query(
    `SELECT ${USER_COLUMNS}, c.name AS "companyName", cr.name AS "customRoleName"
       FROM ${T.users} u
       LEFT JOIN ${T.companies} c ON c.id = u.company_id
       LEFT JOIN ${T.companyRoles} cr ON cr.id = u.custom_role_id
      WHERE u.id = ? AND ${scope.clause}`,
    [id, ...scope.params]
  );
  return rows[0] || null;
}

async function listPage<R>(where: string[], params: unknown[], list: ListWindow, shape: (row: any) => R) {
  const from = `FROM ${T.users} u
       LEFT JOIN ${T.companies} c ON c.id = u.company_id
       LEFT JOIN ${T.companyRoles} cr ON cr.id = u.custom_role_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;

  return pagedRows(
    db,
    `SELECT u.id, u.username, u.email, u.display_name, u.role, u.custom_role_id, u.status, u.last_login_at,
            c.name AS "companyName", cr.name AS "customRoleName", COUNT(*) OVER () AS "__total"
       ${from}
      ${orderBy(list, USER_SORTS, 'u.id')}
      LIMIT ? OFFSET ?`,
    [...params, list.pageSize, list.offset],
    `SELECT COUNT(*) AS n ${from}`,
    params,
    shape
  );
}

async function listOptions(actor: Actor) {
  const scope = companyScope(actor, 'u.company_id');
  const { rows } = await db.query(
    `SELECT u.id, u.username, u.email
       FROM ${T.users} u
      WHERE u.status = 'active' AND ${scope.clause}
      ORDER BY u.username`,
    scope.params
  );
  return rows;
}

async function insert(
  { companyId, username, email, displayName, role, customRoleId = null }: {
    companyId: number | null;
    username: string;
    email: string;
    displayName: string | null;
    role: string;
    customRoleId?: number | null;
  },
  conn?: Queryable
): Promise<number> {
  const client = conn || db;
  const { rows } = await client.query(
    `INSERT INTO ${T.users}
       (company_id, username, email, display_name, password_hash, role, custom_role_id, status, must_change_password)
     VALUES (?, ?, ?, ?, NULL, ?, ?, 'pending', FALSE)
     RETURNING id`,
    [companyId, username, email, displayName, role, customRoleId]
  );
  return rows[0].id;
}

async function updateColumns(id: number, updates: Record<string, unknown>): Promise<void> {
  const entries = Object.entries(updates);
  const sql = entries.map(([column]) => `${column} = ?`).join(', ');
  await db.query(
    `UPDATE ${T.users} SET ${sql} WHERE id = ?`,
    [...entries.map(([, value]) => value), id]
  );
}

async function setActivePassword(conn: Queryable, userId: number, passwordHash: string): Promise<void> {
  await conn.query(
    `UPDATE ${T.users}
        SET password_hash = ?, status = 'active', must_change_password = FALSE
      WHERE id = ?`,
    [passwordHash, userId]
  );
}

async function clearCredential(conn: Queryable, userId: number): Promise<void> {
  await conn.query(
    `UPDATE ${T.users} SET status = 'pending', password_hash = NULL, must_change_password = FALSE
      WHERE id = ?`,
    [userId]
  );
}

async function recordLogin(userId: number): Promise<void> {
  await db.query(`UPDATE ${T.users} SET last_login_at = now() WHERE id = ?`, [userId]);
}

async function remove(id: number): Promise<boolean> {
  const result = await db.query(`DELETE FROM ${T.users} WHERE id = ?`, [id]);
  return result.rowCount! > 0;
}

async function countByCompany(companyId: number): Promise<number> {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM ${T.users} WHERE company_id = ?`,
    [companyId]
  );
  return rows[0].n;
}

export {
  USER_SORTS,
  findByIdentifier,
  findCredentialsById,
  findActorRow,
  findById,
  findInScope,
  listPage,
  listOptions,
  insert,
  updateColumns,
  setActivePassword,
  clearCredential,
  recordLogin,
  remove,
  countByCompany,
};
