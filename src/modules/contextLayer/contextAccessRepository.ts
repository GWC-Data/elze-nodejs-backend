import config from '../../config';
import { Prisma } from '../../generated/prisma/client';
import { rawRows } from '../../shared/db/baseRepository';
import { accessLevelId } from '../catalogue/catalogueService';
import type { Actor } from '../../shared/types/actor';
import type { GeneralAccess } from '../../generated/prisma/enums';

const { prisma } = config.database;

const contextLevel = (level: string) => accessLevelId('context', level);

const MEMBER_GROUP_GRANTS = Prisma.sql`access_control.context_group_access ga
            JOIN groups gr ON gr.id = ga.group_id AND gr.active
            JOIN group_users gu ON gu.group_id = ga.group_id`;

function accessColumns(actor: Pick<Actor, 'id'>): Prisma.Sql {
  return Prisma.sql`c.created_by, c.general_access,
          (SELECT COALESCE(ou.display_name, ou.username) FROM users ou WHERE ou.id = c.created_by) AS owner_name,
          (SELECT l.key FROM access_control.context_user_access a
             JOIN access_control.access_levels l ON l.id = a.access_level_id
            WHERE a.connection_id = c.id AND a.user_id = ${actor.id}) AS granted_level,
          (SELECT l.key FROM ${MEMBER_GROUP_GRANTS}
             JOIN access_control.access_levels l ON l.id = ga.access_level_id
            WHERE ga.connection_id = c.id AND gu.user_id = ${actor.id}
            ORDER BY l.rank DESC
            LIMIT 1) AS group_level`;
}

function visibleClause(actor: Pick<Actor, 'id'>, seeAll: boolean): Prisma.Sql {
  if (seeAll) return Prisma.sql`TRUE`;
  return Prisma.sql`(c.created_by = ${actor.id} OR c.general_access = 'company'
           OR EXISTS (SELECT 1 FROM access_control.context_user_access a
                       WHERE a.connection_id = c.id AND a.user_id = ${actor.id})
           OR EXISTS (SELECT 1 FROM ${MEMBER_GROUP_GRANTS}
                       WHERE ga.connection_id = c.id AND gu.user_id = ${actor.id}))`;
}

async function listGrants(connectionId: string) {
  return rawRows(
    prisma,
    Prisma.sql`SELECT a.user_id, l.key AS access_level, a.access_level_id, a.granted_at,
            u.username, u.email, u.display_name, u.status
       FROM access_control.context_user_access a
       JOIN access_control.access_levels l ON l.id = a.access_level_id
       JOIN users u ON u.id = a.user_id
      WHERE a.connection_id = ${connectionId}::uuid
      ORDER BY COALESCE(u.display_name, u.username)`
  );
}

async function shareablePeople(companyId: number, ownerId: number | null) {
  return rawRows(
    prisma,
    Prisma.sql`SELECT u.id, u.username, u.email, u.display_name
       FROM users u
      WHERE u.company_id = ${companyId} AND u.status = 'active' AND u.id IS DISTINCT FROM ${ownerId}::int
      ORDER BY COALESCE(u.display_name, u.username)`
  );
}

async function findActiveCompanyUser(companyId: number, userId: number) {
  const user = await prisma.user.findFirst({
    where: { id: userId, companyId, status: 'active' },
    select: { id: true, username: true, email: true, displayName: true },
  });
  return user ? { id: user.id, username: user.username, email: user.email, display_name: user.displayName } : null;
}

async function findGrant(connectionId: string, userId: number): Promise<string | null> {
  const grant = await prisma.contextUserAccess.findUnique({
    where: { connectionId_userId: { connectionId, userId } },
    select: { accessLevel: { select: { key: true } } },
  });
  return grant ? grant.accessLevel.key : null;
}

async function upsertGrant(connectionId: string, userId: number, level: string, grantedBy: number): Promise<void> {
  const accessLevelId = contextLevel(level);
  await prisma.contextUserAccess.upsert({
    where: { connectionId_userId: { connectionId, userId } },
    create: { connectionId, userId, accessLevelId, grantedBy },
    update: { accessLevelId, grantedBy, grantedAt: new Date() },
  });
}

async function deleteGrant(connectionId: string, userId: number): Promise<boolean> {
  const result = await prisma.contextUserAccess.deleteMany({ where: { connectionId, userId } });
  return result.count > 0;
}

async function setGeneralAccess(connectionId: string, value: GeneralAccess): Promise<void> {
  await prisma.connection.updateMany({ where: { id: connectionId }, data: { generalAccess: value } });
}

async function listGroupGrants(connectionId: string) {
  const grants = await prisma.contextGroupAccess.findMany({
    where: { connectionId },
    include: {
      accessLevel: { select: { key: true } },
      group: { select: { name: true, active: true, _count: { select: { members: true } } } },
    },
    orderBy: { group: { name: 'asc' } },
  });
  return grants.map((g) => ({
    group_id: g.groupId,
    access_level: g.accessLevel.key,
    access_level_id: g.accessLevelId,
    granted_at: g.grantedAt,
    name: g.group.name,
    active: g.group.active,
    member_count: g.group._count.members,
  }));
}

async function shareableGroups(companyId: number) {
  const groups = await prisma.group.findMany({
    where: { companyId, active: true },
    select: { id: true, name: true, _count: { select: { members: true } } },
    orderBy: { name: 'asc' },
  });
  return groups.map((g) => ({ id: g.id, name: g.name, member_count: g._count.members }));
}

async function findActiveCompanyGroup(companyId: number, groupId: number) {
  return prisma.group.findFirst({ where: { id: groupId, companyId, active: true }, select: { id: true, name: true } });
}

async function findGroupGrant(connectionId: string, groupId: number): Promise<string | null> {
  const grant = await prisma.contextGroupAccess.findUnique({
    where: { connectionId_groupId: { connectionId, groupId } },
    select: { accessLevel: { select: { key: true } } },
  });
  return grant ? grant.accessLevel.key : null;
}

async function upsertGroupGrant(
  connectionId: string,
  groupId: number,
  level: string,
  grantedBy: number
): Promise<void> {
  const accessLevelId = contextLevel(level);
  await prisma.contextGroupAccess.upsert({
    where: { connectionId_groupId: { connectionId, groupId } },
    create: { connectionId, groupId, accessLevelId, grantedBy },
    update: { accessLevelId, grantedBy, grantedAt: new Date() },
  });
}

async function deleteGroupGrant(connectionId: string, groupId: number): Promise<boolean> {
  const result = await prisma.contextGroupAccess.deleteMany({ where: { connectionId, groupId } });
  return result.count > 0;
}

async function listContextsForGroup(groupId: number) {
  return rawRows(
    prisma,
    Prisma.sql`SELECT ga.connection_id, l.key AS access_level, ga.access_level_id, ga.granted_at, c.name, c.provider,
            (SELECT v.name FROM context_layer_versions v
              WHERE v.connection_id = c.id AND v.status = 'published'
              ORDER BY v.version DESC LIMIT 1) AS published_name,
            (SELECT v.version FROM context_layer_versions v
              WHERE v.connection_id = c.id AND v.status = 'published'
              ORDER BY v.version DESC LIMIT 1) AS published_version
       FROM access_control.context_group_access ga
       JOIN access_control.access_levels l ON l.id = ga.access_level_id
       JOIN connections c ON c.id = ga.connection_id
      WHERE ga.group_id = ${groupId}
      ORDER BY c.name`
  );
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
