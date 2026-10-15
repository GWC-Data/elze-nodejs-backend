import config from '../config';
import { CT } from '../models/contextModel';
import { T } from '../models/rbacModel';
import { accessLevelId } from '../services/catalogueService';
import type { Actor } from '../types/actor';

const { db } = config.database;

const levelOf = (alias: string) => `(SELECT l.key FROM ${T.accessLevels} l WHERE l.id = ${alias}.access_level_id)`;
const contextLevel = (level: string) => accessLevelId('context', level);

interface SqlPart {
  sql: string;
  params: unknown[];
}

const MEMBER_GROUP_GRANTS = `${CT.groupAccess} ga
            JOIN ${T.groups} gr ON gr.id = ga.group_id AND gr.active
            JOIN ${T.groupUsers} gu ON gu.group_id = ga.group_id`;

function accessColumns(actor: Pick<Actor, 'id'>): SqlPart {
  return {
    sql: `c.created_by, c.general_access,
          (SELECT COALESCE(ou.display_name, ou.username) FROM ${T.users} ou WHERE ou.id = c.created_by) AS owner_name,
          (SELECT ${levelOf('a')} FROM ${CT.access} a
            WHERE a.connection_id = c.id AND a.user_id = ?) AS granted_level,
          (SELECT l.key FROM ${MEMBER_GROUP_GRANTS}
             JOIN ${T.accessLevels} l ON l.id = ga.access_level_id
            WHERE ga.connection_id = c.id AND gu.user_id = ?
            ORDER BY l.rank DESC
            LIMIT 1) AS group_level`,
    params: [actor.id, actor.id],
  };
}

function visibleClause(actor: Pick<Actor, 'id'>, seeAll: boolean): SqlPart {
  if (seeAll) return { sql: '1 = 1', params: [] };
  return {
    sql: `(c.created_by = ? OR c.general_access = 'company'
           OR EXISTS (SELECT 1 FROM ${CT.access} a WHERE a.connection_id = c.id AND a.user_id = ?)
           OR EXISTS (SELECT 1 FROM ${MEMBER_GROUP_GRANTS}
                       WHERE ga.connection_id = c.id AND gu.user_id = ?))`,
    params: [actor.id, actor.id, actor.id],
  };
}

async function listGrants(connectionId: string) {
  const { rows } = await db.query(
    `SELECT a.user_id, ${levelOf('a')} AS access_level, a.access_level_id, a.granted_at,
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
    `SELECT ${levelOf('a')} AS access_level FROM ${CT.access} a WHERE a.connection_id = ? AND a.user_id = ?`,
    [connectionId, userId]
  );
  return rows[0]?.access_level ?? null;
}

async function upsertGrant(connectionId: string, userId: number, level: string, grantedBy: number): Promise<void> {
  await db.query(
    `INSERT INTO ${CT.access} (connection_id, user_id, access_level_id, granted_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (connection_id, user_id)
       DO UPDATE SET access_level_id = EXCLUDED.access_level_id, granted_by = EXCLUDED.granted_by,
                     granted_at = now()`,
    [connectionId, userId, contextLevel(level), grantedBy]
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

async function listGroupGrants(connectionId: string) {
  const { rows } = await db.query(
    `SELECT ga.group_id, ${levelOf('ga')} AS access_level, ga.access_level_id, ga.granted_at, gr.name, gr.active,
            (SELECT COUNT(*)::int FROM ${T.groupUsers} gu WHERE gu.group_id = gr.id) AS member_count
       FROM ${CT.groupAccess} ga
       JOIN ${T.groups} gr ON gr.id = ga.group_id
      WHERE ga.connection_id = ?
      ORDER BY gr.name`,
    [connectionId]
  );
  return rows;
}

async function shareableGroups(companyId: number) {
  const { rows } = await db.query(
    `SELECT gr.id, gr.name,
            (SELECT COUNT(*)::int FROM ${T.groupUsers} gu WHERE gu.group_id = gr.id) AS member_count
       FROM ${T.groups} gr
      WHERE gr.company_id = ? AND gr.active
      ORDER BY gr.name`,
    [companyId]
  );
  return rows;
}

async function findActiveCompanyGroup(companyId: number, groupId: number) {
  const { rows } = await db.query(
    `SELECT gr.id, gr.name FROM ${T.groups} gr WHERE gr.id = ? AND gr.company_id = ? AND gr.active`,
    [groupId, companyId]
  );
  return rows[0] || null;
}

async function findGroupGrant(connectionId: string, groupId: number): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT ${levelOf('ga')} AS access_level FROM ${CT.groupAccess} ga WHERE ga.connection_id = ? AND ga.group_id = ?`,
    [connectionId, groupId]
  );
  return rows[0]?.access_level ?? null;
}

async function upsertGroupGrant(connectionId: string, groupId: number, level: string, grantedBy: number): Promise<void> {
  await db.query(
    `INSERT INTO ${CT.groupAccess} (connection_id, group_id, access_level_id, granted_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (connection_id, group_id)
       DO UPDATE SET access_level_id = EXCLUDED.access_level_id, granted_by = EXCLUDED.granted_by,
                     granted_at = now()`,
    [connectionId, groupId, contextLevel(level), grantedBy]
  );
}

async function deleteGroupGrant(connectionId: string, groupId: number): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM ${CT.groupAccess} WHERE connection_id = ? AND group_id = ?`,
    [connectionId, groupId]
  );
  return (result.rowCount ?? 0) > 0;
}

async function listContextsForGroup(groupId: number) {
  const { rows } = await db.query(
    `SELECT ga.connection_id, ${levelOf('ga')} AS access_level, ga.access_level_id, ga.granted_at, c.name, c.provider,
            (SELECT v.name FROM ${CT.versions} v
              WHERE v.connection_id = c.id AND v.status = 'published'
              ORDER BY v.version DESC LIMIT 1) AS published_name,
            (SELECT v.version FROM ${CT.versions} v
              WHERE v.connection_id = c.id AND v.status = 'published'
              ORDER BY v.version DESC LIMIT 1) AS published_version
       FROM ${CT.groupAccess} ga
       JOIN ${CT.connections} c ON c.id = ga.connection_id
      WHERE ga.group_id = ?
      ORDER BY c.name`,
    [groupId]
  );
  return rows;
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
  listGroupGrants,
  shareableGroups,
  findActiveCompanyGroup,
  findGroupGrant,
  upsertGroupGrant,
  deleteGroupGrant,
  listContextsForGroup,
};
export type { SqlPart };
