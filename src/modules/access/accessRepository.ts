import config from '../../config';
import { Prisma } from '../../generated/prisma/client';
import { rawRows } from '../../shared/db/baseRepository';
import { accessLevelId } from '../catalogue/catalogueService';
import type { Actor } from '../../shared/types/actor';

const { prisma, withTransaction } = config.database;

const dashboardLevel = (level: string) => accessLevelId('dashboard', level);

const companyDashboardIdsSql = (companyId: number | null) => Prisma.sql`
  SELECT dashboard_id FROM access_control.company_dashboards WHERE company_id = ${companyId}
  UNION
  SELECT id FROM dashboards WHERE company_id = ${companyId}`;

const GROUP_GRANTS = Prisma.sql`access_control.dashboard_group_access gda
       JOIN access_control.access_levels l ON l.id = gda.access_level_id
       JOIN group_users gu ON gu.group_id = gda.group_id
       JOIN groups g ON g.id = gda.group_id`;

async function companyDashboardIds(companyId: number | null): Promise<Set<string>> {
  const rows = await rawRows(prisma, companyDashboardIdsSql(companyId));
  return new Set(rows.map((r) => r.dashboard_id));
}

async function assign(companyId: number, dashboardId: string, assignedBy: number | null): Promise<void> {
  await prisma.companyDashboard.upsert({
    where: { companyId_dashboardId: { companyId, dashboardId } },
    create: { companyId, dashboardId, assignedBy },
    update: { assignedBy, assignedAt: new Date() },
  });
}

async function assignIfMissing(companyId: number, dashboardId: string, assignedBy: number | null): Promise<void> {
  await prisma.companyDashboard.createMany({ data: [{ companyId, dashboardId, assignedBy }], skipDuplicates: true });
}

async function unassign(companyId: number, dashboardId: string): Promise<boolean> {
  return withTransaction(async (tx) => {
    await tx.dashboardUserAccess.deleteMany({ where: { dashboardId, user: { companyId } } });
    await tx.dashboardGroupAccess.deleteMany({ where: { dashboardId, group: { companyId } } });
    const result = await tx.companyDashboard.deleteMany({ where: { companyId, dashboardId } });
    return result.count > 0;
  });
}

async function isAvailable(companyId: number | null, dashboardId: string): Promise<boolean> {
  const [row] = await rawRows(
    prisma,
    Prisma.sql`SELECT EXISTS (
       SELECT 1 FROM access_control.company_dashboards WHERE company_id = ${companyId} AND dashboard_id = ${dashboardId}
       UNION ALL
       SELECT 1 FROM dashboards WHERE company_id = ${companyId} AND id = ${dashboardId}
     ) AS available`
  );
  return Boolean(row?.available);
}

async function gateAndLevels(
  actor: Actor,
  dashboardId: string
): Promise<{ available: boolean; levels: string[] } | null> {
  const [gate] = await rawRows<{ available: boolean; levels: string[] }>(
    prisma,
    Prisma.sql`SELECT EXISTS (
              SELECT 1 FROM access_control.company_dashboards
               WHERE company_id = ${actor.companyId} AND dashboard_id = ${dashboardId}
              UNION ALL
              SELECT 1 FROM dashboards WHERE company_id = ${actor.companyId} AND id = ${dashboardId}
            ) AS available,
            ARRAY(
              SELECT l.key FROM access_control.dashboard_user_access a
                JOIN access_control.access_levels l ON l.id = a.access_level_id
               WHERE a.user_id = ${actor.id} AND a.dashboard_id = ${dashboardId}
              UNION ALL
              SELECT l.key FROM ${GROUP_GRANTS}
               WHERE gu.user_id = ${actor.id} AND gda.dashboard_id = ${dashboardId}
                 AND g.active AND g.company_id = ${actor.companyId}
            ) AS levels`
  );
  return gate || null;
}

async function directUserLevel(userId: unknown, dashboardId: string): Promise<string | null> {
  const id = Number(userId);
  if (!Number.isSafeInteger(id)) return null;
  const grant = await prisma.dashboardUserAccess.findUnique({
    where: { userId_dashboardId: { userId: id, dashboardId } },
    select: { accessLevel: { select: { key: true } } },
  });
  return grant ? grant.accessLevel.key : null;
}

async function grantRowsForUser(actor: Actor) {
  return rawRows(
    prisma,
    Prisma.sql`SELECT a.dashboard_id, l.key AS access_level
       FROM access_control.dashboard_user_access a
       JOIN access_control.access_levels l ON l.id = a.access_level_id
      WHERE a.user_id = ${actor.id}
     UNION ALL
     SELECT gda.dashboard_id, l.key
       FROM ${GROUP_GRANTS}
      WHERE gu.user_id = ${actor.id} AND g.active AND g.company_id = ${actor.companyId}`
  );
}

async function countCompanyDashboards(companyId: number | null): Promise<number> {
  const [row] = await rawRows(
    prisma,
    Prisma.sql`SELECT COUNT(*)::int AS n FROM (${companyDashboardIdsSql(companyId)}) avail`
  );
  return row.n;
}

async function countGrantedDashboards(actor: Actor): Promise<number> {
  const [row] = await rawRows(
    prisma,
    Prisma.sql`SELECT COUNT(*)::int AS n
       FROM (${companyDashboardIdsSql(actor.companyId)}) avail
       JOIN (
         SELECT dashboard_id FROM access_control.dashboard_user_access WHERE user_id = ${actor.id}
         UNION
         SELECT gda.dashboard_id
           FROM access_control.dashboard_group_access gda
           JOIN group_users gu ON gu.group_id = gda.group_id
           JOIN groups g ON g.id = gda.group_id
          WHERE gu.user_id = ${actor.id} AND g.active AND g.company_id = ${actor.companyId}
       ) granted ON granted.dashboard_id = avail.dashboard_id`
  );
  return row.n;
}

async function userGrantRows(userId: number) {
  return rawRows(
    prisma,
    Prisma.sql`SELECT a.dashboard_id AS "dashboardId", l.key AS level, a.access_level_id AS "levelId",
            'direct' AS origin, NULL::int AS "groupId", NULL::text AS "groupName"
       FROM access_control.dashboard_user_access a
       JOIN access_control.access_levels l ON l.id = a.access_level_id
      WHERE a.user_id = ${userId}
     UNION ALL
     SELECT gda.dashboard_id, l.key, gda.access_level_id, 'group', g.id, g.name
       FROM ${GROUP_GRANTS}
      WHERE gu.user_id = ${userId} AND g.active
      ORDER BY 1`
  );
}

async function dashboardUserGrants(companyId: number | null, dashboardId: string) {
  if (companyId === null) return [];
  const grants = await prisma.dashboardUserAccess.findMany({
    where: { dashboardId, user: { companyId } },
    include: { user: { select: { username: true, email: true } }, accessLevel: { select: { key: true } } },
    orderBy: { user: { username: 'asc' } },
  });
  return grants.map((g) => ({
    userId: g.userId,
    username: g.user.username,
    email: g.user.email,
    level: g.accessLevel.key,
    levelId: g.accessLevelId,
  }));
}

async function dashboardGroupGrants(companyId: number | null, dashboardId: string) {
  if (companyId === null) return [];
  const grants = await prisma.dashboardGroupAccess.findMany({
    where: { dashboardId, group: { companyId } },
    include: { group: { select: { name: true, active: true } }, accessLevel: { select: { key: true } } },
    orderBy: { group: { name: 'asc' } },
  });
  return grants.map((g) => ({
    groupId: g.groupId,
    groupName: g.group.name,
    level: g.accessLevel.key,
    levelId: g.accessLevelId,
    active: g.group.active,
  }));
}

async function groupGrantLevels(groupId: number) {
  const grants = await prisma.dashboardGroupAccess.findMany({
    where: { groupId },
    include: { accessLevel: { select: { key: true } } },
  });
  return grants.map((g) => ({
    dashboard_id: g.dashboardId,
    access_level: g.accessLevel.key,
    access_level_id: g.accessLevelId,
  }));
}

async function grantUser(userId: number, dashboardId: string, level: string, grantedBy: number | null): Promise<void> {
  const accessLevelId = dashboardLevel(level);
  await prisma.dashboardUserAccess.upsert({
    where: { userId_dashboardId: { userId, dashboardId } },
    create: { userId, dashboardId, accessLevelId, grantedBy },
    update: { accessLevelId, grantedBy },
  });
}

async function grantCreatorAdmin(userId: number, dashboardId: string): Promise<void> {
  const accessLevelId = dashboardLevel('admin');
  await prisma.dashboardUserAccess.upsert({
    where: { userId_dashboardId: { userId, dashboardId } },
    create: { userId, dashboardId, accessLevelId, grantedBy: userId },
    update: { accessLevelId },
  });
}

async function revokeUser(userId: number, dashboardId: string): Promise<boolean> {
  const result = await prisma.dashboardUserAccess.deleteMany({ where: { userId, dashboardId } });
  return result.count > 0;
}

async function grantGroup(
  groupId: number,
  dashboardId: string,
  level: string,
  grantedBy: number | null
): Promise<void> {
  const accessLevelId = dashboardLevel(level);
  await prisma.dashboardGroupAccess.upsert({
    where: { groupId_dashboardId: { groupId, dashboardId } },
    create: { groupId, dashboardId, accessLevelId, grantedBy },
    update: { accessLevelId, grantedBy },
  });
}

async function revokeGroup(groupId: number, dashboardId: string): Promise<boolean> {
  const result = await prisma.dashboardGroupAccess.deleteMany({ where: { groupId, dashboardId } });
  return result.count > 0;
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
