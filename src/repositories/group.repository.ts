import config from '../config';
import { T } from '../models/rbac.model';
import { companyScope } from './base.repository';
import type { Queryable } from '../config/pgPool';
import type { Actor } from '../types/actor';

const { db } = config.database;

const LIST_SQL = `
  SELECT g.id, g.company_id AS "companyId", c.name AS "companyName", g.name, g.active,
         g.created_at AS "createdAt", COUNT(gu.user_id) AS "memberCount"
    FROM ${T.groups} g
    JOIN ${T.companies} c ON c.id = g.company_id
    LEFT JOIN ${T.groupUsers} gu ON gu.group_id = g.id`;

async function list(actor: Actor) {
  const scope = companyScope(actor, 'g.company_id');
  const { rows } = await db.query(
    `${LIST_SQL} WHERE ${scope.clause} GROUP BY g.id, c.name ORDER BY c.name, g.name`,
    scope.params
  );
  return rows;
}

async function findInScope(actor: Actor, id: unknown) {
  const scope = companyScope(actor, 'g.company_id');
  const { rows } = await db.query(
    `${LIST_SQL} WHERE g.id = ? AND ${scope.clause} GROUP BY g.id, c.name`,
    [id, ...scope.params]
  );
  return rows[0] || null;
}

async function memberIds(groupId: number): Promise<number[]> {
  const { rows } = await db.query(
    `SELECT user_id FROM ${T.groupUsers} WHERE group_id = ?`,
    [groupId]
  );
  return rows.map((r) => r.user_id);
}

async function listMembers(groupId: number) {
  const { rows } = await db.query(
    `SELECT u.id, u.username, u.email, u.role, u.status
       FROM ${T.groupUsers} gu
       JOIN ${T.users} u ON u.id = gu.user_id
      WHERE gu.group_id = ? ORDER BY u.username`,
    [groupId]
  );
  return rows;
}

async function clearMembers(conn: Queryable, groupId: number): Promise<void> {
  await conn.query(`DELETE FROM ${T.groupUsers} WHERE group_id = ?`, [groupId]);
}

async function usersInCompany(conn: Queryable, userIds: readonly number[], companyId: number | null): Promise<number[]> {
  const { rows } = await conn.query(
    `SELECT id FROM ${T.users}
      WHERE id IN (${userIds.map(() => '?').join(', ')}) AND company_id = ?`,
    [...userIds, companyId]
  );
  return rows.map((r) => r.id);
}

async function insertMembers(conn: Queryable, groupId: number, userIds: readonly number[]): Promise<void> {
  const placeholders = userIds.map(() => '(?, ?)').join(', ');
  await conn.query(
    `INSERT INTO ${T.groupUsers} (group_id, user_id) VALUES ${placeholders}`,
    userIds.flatMap((id) => [groupId, id])
  );
}

async function insert(
  conn: Queryable,
  { companyId, name, active, creatorId }: { companyId: number | null; name: string; active: boolean; creatorId: number | null }
): Promise<number> {
  const { rows } = await conn.query(
    `INSERT INTO ${T.groups} (company_id, name, active, creator_id) VALUES (?, ?, ?, ?)
     RETURNING id`,
    [companyId, name, active, creatorId]
  );
  return rows[0].id;
}

async function updateColumns(conn: Queryable, id: unknown, updates: string[], params: unknown[]): Promise<void> {
  await conn.query(`UPDATE ${T.groups} SET ${updates.join(', ')} WHERE id = ?`, [...params, id]);
}

async function remove(id: unknown): Promise<void> {
  await db.query(`DELETE FROM ${T.groups} WHERE id = ?`, [id]);
}

export {
  list,
  findInScope,
  memberIds,
  listMembers,
  clearMembers,
  usersInCompany,
  insertMembers,
  insert,
  updateColumns,
  remove,
};
