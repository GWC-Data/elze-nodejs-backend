import config from '../config';
import { T, V } from '../models/rbacModel';
import { pagedRows, companyScope } from './baseRepository';
import { orderBy } from '../tools/listQuery';
import type { Queryable } from '../config/pgPool';
import type { Actor } from '../types/actor';
import type { ListWindow } from './baseRepository';

const { db, withTransaction } = config.database;

const ROLE_JOIN = `LEFT JOIN ${T.userRoles} ur ON ur.user_id = u.id
       LEFT JOIN ${T.roles} r ON r.id = ur.role_id`;

const ROLE_COLUMNS = `r.tier AS role, ur.role_id, r.name AS role_name, r.kind AS role_kind`;

const USER_COLUMNS = `u.id, u.company_id, u.username, u.email, u.display_name,
                      (u.password_hash IS NOT NULL) AS has_password,
                      ${ROLE_COLUMNS}, u.status, u.must_change_password,
                      u.last_login_at, u.created_at`;

const USER_SORTS: Record<string, string> = {
  name: 'lower(COALESCE(u.display_name, u.username))',
  company: 'lower(c.name)',
  role: 'r.tier',
  status: 'u.status',
  lastLogin: 'u.last_login_at',
};

async function findByIdentifier(value: string) {
  const { rows } = await db.query(
    `SELECT ${USER_COLUMNS}, u.password_hash,
            c.active AS "companyActive", c.name AS "companyName"
       FROM ${T.users} u
       LEFT JOIN ${T.companies} c ON c.id = u.company_id
       ${ROLE_JOIN}
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
    `SELECT ${USER_COLUMNS}, c.active AS "companyActive", c.name AS "companyName",
            COALESCE((SELECT array_agg(e.permission_key ORDER BY e.permission_key)
                        FROM ${V.userEffectivePermissions} e
                       WHERE e.user_id = u.id AND e.is_effective), '{}') AS permissions,
            COALESCE((SELECT cf.feature_ids FROM ${T.companyFeatures} cf
                       WHERE cf.company_id = u.company_id), '{}') AS feature_ids,
            COALESCE((SELECT json_agg(json_build_array(d.key, v.value) ORDER BY d.key, v.value)
                        FROM ${T.userDataScopes} s
                        CROSS JOIN LATERAL jsonb_each(s.scopes) AS d
                        CROSS JOIN LATERAL jsonb_array_elements_text(d.value) AS v(value)
                       WHERE s.user_id = u.id), '[]') AS scopes
       FROM ${T.users} u
       LEFT JOIN ${T.companies} c ON c.id = u.company_id
       ${ROLE_JOIN}
      WHERE u.id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function findById(id: number, conn?: Queryable) {
  const client = conn || db;
  const { rows } = await client.query(
    `SELECT ${USER_COLUMNS}, c.active AS "companyActive", c.name AS "companyName"
       FROM ${T.users} u
       LEFT JOIN ${T.companies} c ON c.id = u.company_id
       ${ROLE_JOIN}
      WHERE u.id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function findInScope(actor: Actor, id: unknown) {
  const scope = companyScope(actor, 'u.company_id');
  const { rows } = await db.query(
    `SELECT ${USER_COLUMNS}, c.name AS "companyName"
       FROM ${T.users} u
       LEFT JOIN ${T.companies} c ON c.id = u.company_id
       ${ROLE_JOIN}
      WHERE u.id = ? AND ${scope.clause}`,
    [id, ...scope.params]
  );
  return rows[0] || null;
}

async function listPage<R>(where: string[], params: unknown[], list: ListWindow, shape: (row: any) => R) {
  const from = `FROM ${T.users} u
       LEFT JOIN ${T.companies} c ON c.id = u.company_id
       ${ROLE_JOIN}
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;

  return pagedRows(
    db,
    `SELECT u.id, u.username, u.email, u.display_name, ${ROLE_COLUMNS}, u.status, u.last_login_at,
            c.name AS "companyName", COUNT(*) OVER () AS "__total"
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
  { companyId, username, email, displayName, roleId, assignedBy = null }: {
    companyId: number | null;
    username: string;
    email: string;
    displayName: string | null;
    roleId: string;
    assignedBy?: number | null;
  },
  conn?: Queryable
): Promise<number> {
  const work = async (client: Queryable) => {
    const { rows } = await client.query(
      `INSERT INTO ${T.users}
         (company_id, username, email, display_name, password_hash, status, must_change_password)
       VALUES (?, ?, ?, ?, NULL, 'pending', FALSE)
       RETURNING id`,
      [companyId, username, email, displayName]
    );
    await client.query(
      `INSERT INTO ${T.userRoles} (user_id, role_id, assigned_by) VALUES (?, ?, ?)`,
      [rows[0].id, roleId, assignedBy]
    );
    return rows[0].id as number;
  };
  return conn ? work(conn) : withTransaction(work);
}

async function setRole(userId: number, roleId: string, assignedBy: number | null): Promise<void> {
  await db.query(
    `INSERT INTO ${T.userRoles} (user_id, role_id, assigned_by) VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE
       SET role_id = EXCLUDED.role_id, assigned_by = EXCLUDED.assigned_by, assigned_at = now()`,
    [userId, roleId, assignedBy]
  );
}

async function updateColumns(id: number, updates: Record<string, unknown>): Promise<void> {
  const entries = Object.entries(updates);
  if (!entries.length) return;
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
  ROLE_JOIN,
  findByIdentifier,
  findCredentialsById,
  findActorRow,
  findById,
  findInScope,
  listPage,
  listOptions,
  insert,
  setRole,
  updateColumns,
  setActivePassword,
  clearCredential,
  recordLogin,
  remove,
  countByCompany,
};
