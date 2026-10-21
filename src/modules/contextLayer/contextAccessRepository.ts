import config from '../../config';
import { Prisma } from '../../generated/prisma/client';
import { rawRows } from '../../shared/db/baseRepository';
import { NOT_DELETED } from '../../shared/db/softDelete';
import { accessLevelId } from '../catalogue/catalogueService';
import type { Actor } from '../../shared/types/actor';
import type { GeneralAccess, UserStatus } from '../../generated/prisma/enums';

const { prisma } = config.database;

interface AccessColumnsRow {
  created_by: number | null;
  general_access: GeneralAccess;
  owner_name: string | null;
  granted_level: string | null;
  group_level: string | null;
}

interface GrantRow {
  user_id: number;
  access_level: string;
  access_level_id: string;
  granted_at: Date;
  username: string;
  email: string;
  display_name: string | null;
  status: UserStatus;
}

interface PersonRow {
  id: number;
  username: string;
  email: string;
  display_name: string | null;
}

interface GroupGrantRow {
  group_id: number;
  access_level: string;
  access_level_id: string;
  granted_at: Date;
  name: string;
  active: boolean;
  member_count: number;
}

interface ShareableGroupRow {
  id: number;
  name: string;
  member_count: number;
}

interface GroupContextRow {
  connection_id: string;
  access_level: string;
  access_level_id: string;
  granted_at: Date;
  name: string;
  provider: string;
  published_name: string | null;
  published_version: number | null;
}

const contextLevel = (level: string) => accessLevelId('context', level);

const MEMBER_GROUP_GRANTS = Prisma.sql`access_control.context_group_access ga
            JOIN groups gr ON gr.id = ga.group_id AND gr.active AND gr.deleted_at IS NULL
            JOIN group_users gu ON gu.group_id = ga.group_id`;

function accessColumns(actor: Pick<Actor, 'id'>): Prisma.Sql {
  return Prisma.sql`(SELECT ou.id FROM users ou WHERE ou.id = c.created_by AND ou.deleted_at IS NULL) AS created_by,
          c.general_access,
          (SELECT COALESCE(ou.display_name, ou.username) FROM users ou
            WHERE ou.id = c.created_by AND ou.deleted_at IS NULL) AS owner_name,
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
  if (seeAll) return Prisma.sql`c.deleted_at IS NULL`;
  return Prisma.sql`(c.deleted_at IS NULL AND (c.created_by = ${actor.id}
           OR EXISTS (SELECT 1 FROM access_control.context_user_access a
                       WHERE a.connection_id = c.id AND a.user_id = ${actor.id})
           OR EXISTS (SELECT 1 FROM ${MEMBER_GROUP_GRANTS}
                       WHERE ga.connection_id = c.id AND gu.user_id = ${actor.id})))`;
}

async function listGrants(connectionId: string): Promise<GrantRow[]> {
  return rawRows<GrantRow>(
    prisma,
    Prisma.sql`SELECT a.user_id, l.key AS access_level, a.access_level_id, a.granted_at,
            u.username, u.email, u.display_name, u.status
       FROM access_control.context_user_access a
       JOIN access_control.access_levels l ON l.id = a.access_level_id
       JOIN users u ON u.id = a.user_id AND u.deleted_at IS NULL
      WHERE a.connection_id = ${connectionId}::uuid
      ORDER BY COALESCE(u.display_name, u.username)`
  );
}

async function shareablePeople(companyId: number, ownerId: number | null): Promise<PersonRow[]> {
  return rawRows<PersonRow>(
    prisma,
    Prisma.sql`SELECT u.id, u.username, u.email, u.display_name
       FROM users u
      WHERE u.company_id = ${companyId} AND u.status = 'active' AND u.deleted_at IS NULL
        AND u.id IS DISTINCT FROM ${ownerId}::int
      ORDER BY COALESCE(u.display_name, u.username)`
  );
}

async function findActiveCompanyUser(companyId: number, userId: number): Promise<PersonRow | null> {
  const user = await prisma.user.findFirst({
    where: { id: userId, companyId, status: 'active', ...NOT_DELETED },
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

async function listGroupGrants(connectionId: string): Promise<GroupGrantRow[]> {
  const grants = await prisma.contextGroupAccess.findMany({
    where: { connectionId, group: NOT_DELETED },
    include: {
      accessLevel: { select: { key: true } },
      group: {
        select: { name: true, active: true, _count: { select: { members: { where: { user: NOT_DELETED } } } } },
      },
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

async function shareableGroups(companyId: number): Promise<ShareableGroupRow[]> {
  const groups = await prisma.group.findMany({
    where: { companyId, active: true, ...NOT_DELETED },
    select: { id: true, name: true, _count: { select: { members: { where: { user: NOT_DELETED } } } } },
    orderBy: { name: 'asc' },
  });
  return groups.map((g) => ({ id: g.id, name: g.name, member_count: g._count.members }));
}

async function findActiveCompanyGroup(
  companyId: number,
  groupId: number
): Promise<{ id: number; name: string } | null> {
  return prisma.group.findFirst({
    where: { id: groupId, companyId, active: true, ...NOT_DELETED },
    select: { id: true, name: true },
  });
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

async function listContextsForGroup(groupId: number): Promise<GroupContextRow[]> {
  const grants = await prisma.contextGroupAccess.findMany({
    where: { groupId, connection: NOT_DELETED },
    select: {
      connectionId: true,
      accessLevelId: true,
      grantedAt: true,
      accessLevel: { select: { key: true } },
      connection: {
        select: {
          name: true,
          provider: true,
          versions: {
            where: { status: 'published', ...NOT_DELETED },
            orderBy: { version: 'desc' },
            take: 1,
            select: { name: true, version: true },
          },
        },
      },
    },
    orderBy: { connection: { name: 'asc' } },
  });
  return grants.map((g) => {
    const published = g.connection.versions.at(0);
    return {
      connection_id: g.connectionId,
      access_level: g.accessLevel.key,
      access_level_id: g.accessLevelId,
      granted_at: g.grantedAt,
      name: g.connection.name,
      provider: g.connection.provider,
      published_name: published ? published.name : null,
      published_version: published ? published.version : null,
    };
  });
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
export type { AccessColumnsRow, GrantRow, PersonRow, GroupGrantRow, ShareableGroupRow, GroupContextRow };
