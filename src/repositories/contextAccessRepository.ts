import config from '../config';
import { CT } from '../models/contextModel';
import { T } from '../models/rbacModel';
import type { Actor } from '../types/actor';

const { db } = config.database;

interface SqlPart {
  sql: string;
  params: unknown[];
}

function accessColumns(actor: Pick<Actor, 'id'>): SqlPart {
  return {
    sql: `c.created_by, c.general_access,
          (SELECT COALESCE(ou.display_name, ou.username) FROM ${T.users} ou WHERE ou.id = c.created_by) AS owner_name,
          (SELECT a.access_level FROM ${CT.access} a
            WHERE a.connection_id = c.id AND a.user_id = ?) AS granted_level`,
    params: [actor.id],
  };
}

function visibleClause(actor: Pick<Actor, 'id'>, seeAll: boolean): SqlPart {
  if (seeAll) return { sql: '1 = 1', params: [] };
  return {
    sql: `(c.created_by = ? OR c.general_access = 'company'
           OR EXISTS (SELECT 1 FROM ${CT.access} a WHERE a.connection_id = c.id AND a.user_id = ?))`,
    params: [actor.id, actor.id],
  };
}

async function listGrants(connectionId: string) {
  const { rows } = await db.query(
    `SELECT a.user_id, a.access_level, a.granted_at,
            u.username, u.email, u.display_name, u.status
       FROM ${CT.access} a
       JOIN ${T.users} u ON u.id = a.user_id
      WHERE a.connection_id = ?
      ORDER BY COALESCE(u.display_name, u.username)`,
    [connectionId]
  );
  return rows;
}

async function shareablePeople(companyId: number, ownerId: number | null) {
  const { rows } = await db.query(
    `SELECT u.id, u.username, u.email, u.display_name
       FROM ${T.users} u
      WHERE u.company_id = ? AND u.status = 'active' AND u.id IS DISTINCT FROM ?
      ORDER BY COALESCE(u.display_name, u.username)`,
    [companyId, ownerId]
  );
  return rows;
}

async function findActiveCompanyUser(companyId: number, userId: number) {
  const { rows } = await db.query(
    `SELECT u.id, u.username, u.email, u.display_name
       FROM ${T.users} u
      WHERE u.id = ? AND u.company_id = ? AND u.status = 'active'`,
    [userId, companyId]
  );
  return rows[0] || null;
}

async function findGrant(connectionId: string, userId: number): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT access_level FROM ${CT.access} WHERE connection_id = ? AND user_id = ?`,
    [connectionId, userId]
  );
  return rows[0]?.access_level ?? null;
}

async function upsertGrant(connectionId: string, userId: number, level: string, grantedBy: number): Promise<void> {
  await db.query(
    `INSERT INTO ${CT.access} (connection_id, user_id, access_level, granted_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (connection_id, user_id)
       DO UPDATE SET access_level = EXCLUDED.access_level, granted_by = EXCLUDED.granted_by,
                     granted_at = now()`,
    [connectionId, userId, level, grantedBy]
  );
}

async function deleteGrant(connectionId: string, userId: number): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM ${CT.access} WHERE connection_id = ? AND user_id = ?`,
    [connectionId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

async function setGeneralAccess(connectionId: string, value: string): Promise<void> {
  await db.query(`UPDATE ${CT.connections} SET general_access = ? WHERE id = ?`, [value, connectionId]);
}

export {
  accessColumns,
  visibleClause,
  listGrants,
  shareablePeople,
  findActiveCompanyUser,
  findGrant,
  upsertGrant,
  deleteGrant,
  setGeneralAccess,
};
export type { SqlPart };
