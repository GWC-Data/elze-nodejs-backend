import config from '../config';
import { T } from '../models/rbac.model';
import type { Queryable } from '../config/pgPool';
import type { Actor } from '../types/actor';

const { db, withTransaction } = config.database;

const COMPANY_DASHBOARD_IDS_SQL = `
  SELECT dashboard_id FROM ${T.companyDashboards} WHERE company_id = ?
  UNION
  SELECT id FROM ${T.dashboards} WHERE company_id = ?`;

async function companyDashboardIds(companyId: number | null): Promise<Set<string>> {
  const { rows } = await db.query(COMPANY_DASHBOARD_IDS_SQL, [companyId, companyId]);
  return new Set(rows.map((r) => r.dashboard_id));
}

async function assign(companyId: number, dashboardId: string, assignedBy: number | null): Promise<void> {
  await db.query(
    `INSERT INTO ${T.companyDashboards} (company_id, dashboard_id, assigned_by)
     VALUES (?, ?, ?)
     ON CONFLICT (company_id, dashboard_id)
       DO UPDATE SET assigned_by = EXCLUDED.assigned_by, assigned_at = now()`,
    [companyId, dashboardId, assignedBy]
  );
}

async function assignIfMissing(companyId: number, dashboardId: string, assignedBy: number | null): Promise<void> {
  await db.query(
    `INSERT INTO ${T.companyDashboards} (company_id, dashboard_id, assigned_by)
     VALUES (?, ?, ?)
     ON CONFLICT (company_id, dashboard_id) DO NOTHING`,
    [companyId, dashboardId, assignedBy]
  );
}

async function unassign(companyId: number, dashboardId: string): Promise<boolean> {
  return withTransaction(async (conn: Queryable) => {
    await conn.query(
      `DELETE FROM ${T.dashboardAccess}
        WHERE dashboard_id = ?
          AND user_id IN (SELECT id FROM ${T.users} WHERE company_id = ?)`,
      [dashboardId, companyId]
    );
    await conn.query(
      `DELETE FROM ${T.groupDashboardAccess}
        WHERE dashboard_id = ?
          AND group_id IN (SELECT id FROM ${T.groups} WHERE company_id = ?)`,
      [dashboardId, companyId]
    );
    const result = await conn.query(
      `DELETE FROM ${T.companyDashboards} WHERE company_id = ? AND dashboard_id = ?`,
      [companyId, dashboardId]
    );
    return result.rowCount! > 0;
  });
}

async function isAvailable(companyId: number | null, dashboardId: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM ${T.companyDashboards} WHERE company_id = ? AND dashboard_id = ?
       UNION ALL
       SELECT 1 FROM ${T.dashboards} WHERE company_id = ? AND id = ?
     ) AS available`,
    [companyId, dashboardId, companyId, dashboardId]
  );
  return Boolean(rows[0] && rows[0].available);
}

async function gateAndLevels(actor: Actor, dashboardId: string): Promise<{ available: boolean; levels: string[] } | null> {
  const { rows: [gate] } = await db.query(
    `SELECT EXISTS (
              SELECT 1 FROM ${T.companyDashboards} WHERE company_id = ? AND dashboard_id = ?
              UNION ALL
              SELECT 1 FROM ${T.dashboards} WHERE company_id = ? AND id = ?
            ) AS available,
            ARRAY(
              SELECT access_level FROM ${T.dashboardAccess}
               WHERE user_id = ? AND dashboard_id = ?
              UNION ALL
              SELECT gda.access_level
                FROM ${T.groupDashboardAccess} gda
                JOIN ${T.groupUsers} gu ON gu.group_id = gda.group_id
                JOIN ${T.groups} g ON g.id = gda.group_id
               WHERE gu.user_id = ? AND gda.dashboard_id = ? AND g.active AND g.company_id = ?
            ) AS levels`,
    [actor.companyId, dashboardId, actor.companyId, dashboardId,
      actor.id, dashboardId, actor.id, dashboardId, actor.companyId]
  );
  return gate || null;
}

async function directUserLevel(userId: unknown, dashboardId: string): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT access_level FROM ${T.dashboardAccess} WHERE user_id = ? AND dashboard_id = ?`,
    [userId, dashboardId]
  );
  return rows[0] ? rows[0].access_level : null;
}

async function grantRowsForUser(actor: Actor) {
  const { rows } = await db.query(
    `SELECT dashboard_id, access_level FROM ${T.dashboardAccess} WHERE user_id = ?
     UNION ALL
     SELECT gda.dashboard_id, gda.access_level
       FROM ${T.groupDashboardAccess} gda
       JOIN ${T.groupUsers} gu ON gu.group_id = gda.group_id
       JOIN ${T.groups} g ON g.id = gda.group_id
      WHERE gu.user_id = ? AND g.active AND g.company_id = ?`,
    [actor.id, actor.id, actor.companyId]
  );
  return rows;
}

async function countCompanyDashboards(companyId: number | null): Promise<number> {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM (${COMPANY_DASHBOARD_IDS_SQL}) avail`,
    [companyId, companyId]
  );
  return rows[0].n;
}

async function countGrantedDashboards(actor: Actor): Promise<number> {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n
       FROM (${COMPANY_DASHBOARD_IDS_SQL}) avail
       JOIN (
         SELECT dashboard_id FROM ${T.dashboardAccess} WHERE user_id = ?
         UNION
         SELECT gda.dashboard_id
           FROM ${T.groupDashboardAccess} gda
           JOIN ${T.groupUsers} gu ON gu.group_id = gda.group_id
           JOIN ${T.groups} g ON g.id = gda.group_id
          WHERE gu.user_id = ? AND g.active AND g.company_id = ?
       ) granted ON granted.dashboard_id = avail.dashboard_id`,
    [actor.companyId, actor.companyId, actor.id, actor.id, actor.companyId]
  );
  return rows[0].n;
}

async function userGrantRows(userId: number) {
  const { rows } = await db.query(
    `SELECT dashboard_id AS "dashboardId", access_level AS level, 'direct' AS origin,
            NULL::int AS "groupId", NULL::text AS "groupName"
       FROM ${T.dashboardAccess} WHERE user_id = ?
     UNION ALL
     SELECT gda.dashboard_id, gda.access_level, 'group', g.id, g.name
       FROM ${T.groupDashboardAccess} gda
       JOIN ${T.groups} g ON g.id = gda.group_id
       JOIN ${T.groupUsers} gu ON gu.group_id = gda.group_id
      WHERE gu.user_id = ? AND g.active
      ORDER BY 1`,
    [userId, userId]
  );
  return rows;
}

async function dashboardUserGrants(companyId: number | null, dashboardId: string) {
  const { rows } = await db.query(
    `SELECT a.user_id AS "userId", u.username, u.email, a.access_level AS level
       FROM ${T.dashboardAccess} a
       JOIN ${T.users} u ON u.id = a.user_id
      WHERE a.dashboard_id = ? AND u.company_id = ?
      ORDER BY u.username`,
    [dashboardId, companyId]
  );
  return rows;
}

async function dashboardGroupGrants(companyId: number | null, dashboardId: string) {
  const { rows } = await db.query(
    `SELECT gda.group_id AS "groupId", g.name AS "groupName", gda.access_level AS level,
            g.active
       FROM ${T.groupDashboardAccess} gda
       JOIN ${T.groups} g ON g.id = gda.group_id
      WHERE gda.dashboard_id = ? AND g.company_id = ?
      ORDER BY g.name`,
    [dashboardId, companyId]
  );
  return rows;
}

async function groupGrantLevels(groupId: number) {
  const { rows } = await db.query(
    `SELECT dashboard_id, access_level FROM ${T.groupDashboardAccess} WHERE group_id = ?`,
    [groupId]
  );
  return rows;
}

async function grantUser(userId: number, dashboardId: string, level: string, grantedBy: number | null): Promise<void> {
  await db.query(
    `INSERT INTO ${T.dashboardAccess} (user_id, dashboard_id, access_level, granted_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, dashboard_id)
       DO UPDATE SET access_level = EXCLUDED.access_level, granted_by = EXCLUDED.granted_by`,
    [userId, dashboardId, level, grantedBy]
  );
}

async function grantCreatorAdmin(userId: number, dashboardId: string): Promise<void> {
  await db.query(
    `INSERT INTO ${T.dashboardAccess} (user_id, dashboard_id, access_level, granted_by)
     VALUES (?, ?, 'admin', ?)
     ON CONFLICT (user_id, dashboard_id) DO UPDATE SET access_level = 'admin'`,
    [userId, dashboardId, userId]
  );
}

async function revokeUser(userId: number, dashboardId: string): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM ${T.dashboardAccess} WHERE user_id = ? AND dashboard_id = ?`,
    [userId, dashboardId]
  );
  return result.rowCount! > 0;
}

async function grantGroup(groupId: number, dashboardId: string, level: string, grantedBy: number | null): Promise<void> {
  await db.query(
    `INSERT INTO ${T.groupDashboardAccess} (group_id, dashboard_id, access_level, granted_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (group_id, dashboard_id)
       DO UPDATE SET access_level = EXCLUDED.access_level, granted_by = EXCLUDED.granted_by`,
    [groupId, dashboardId, level, grantedBy]
  );
}

async function revokeGroup(groupId: number, dashboardId: string): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM ${T.groupDashboardAccess} WHERE group_id = ? AND dashboard_id = ?`,
    [groupId, dashboardId]
  );
  return result.rowCount! > 0;
}

export {
  companyDashboardIds,
  assign,
  assignIfMissing,
  unassign,
  isAvailable,
  gateAndLevels,
  directUserLevel,
  grantRowsForUser,
  countCompanyDashboards,
  countGrantedDashboards,
  userGrantRows,
  dashboardUserGrants,
  dashboardGroupGrants,
  groupGrantLevels,
  grantUser,
  grantCreatorAdmin,
  revokeUser,
  grantGroup,
  revokeGroup,
};
