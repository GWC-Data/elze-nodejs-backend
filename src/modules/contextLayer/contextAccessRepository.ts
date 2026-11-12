import config from '../../config';
import { Prisma } from '../../generated/prisma/client';
import { rawRows } from '../../shared/db/baseRepository';
import { NOT_DELETED } from '../../shared/db/softDelete';
import { accessLevelId } from '../catalogue/catalogueService';
import type { Actor } from '../../shared/types/actor';
import type { GeneralAccess, UserStatus } from '../../generated/prisma/enums';

const { prisma } = config.database;

interface AccessColumnsRow {
  created_by: string | null;
  context_company_id: string | null;
  general_access: GeneralAccess;
  owner_name: string | null;
  granted_level: string | null;
  group_level: string | null;
  company_level: string | null;
  shared_count: number;
}

interface GrantRow {
  user_id: string;
  access_level: string;
  access_level_id: string;
  granted_at: Date;
  username: string;
  email: string;
  display_name: string | null;
  status: UserStatus;
  company_name: string | null;
}

interface PersonRow {
  id: string;
  username: string;
  email: string;
  display_name: string | null;
  company_name: string | null;
}

interface GroupGrantRow {
  group_id: string;
  access_level: string;
  access_level_id: string;
  granted_at: Date;
  name: string;
  active: boolean;
  member_count: number;
  company_name: string | null;
}

interface ShareableGroupRow {
  id: string;
  name: string;
  member_count: number;
  company_name: string | null;
}

interface CompanyGrantRow {
  company_id: string;
  access_level: string;
  access_level_id: string;
  granted_at: Date;
  name: string;
  active: boolean;
  member_count: number;
}

interface ShareableCompanyRow {
  id: string;
  name: string;
  member_count: number;
}

type AccessActor = Pick<Actor, 'id' | 'companyId' | 'isPlatform'>;

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

const COMPANY_MEMBERS = Prisma.sql`(SELECT COUNT(*)::int FROM users mu
            WHERE mu.company_id = co.id AND mu.deleted_at IS NULL AND mu.status = 'active')`;

function accessColumns(actor: Pick<Actor, 'id' | 'companyId'>): Prisma.Sql {
  return Prisma.sql`(SELECT ou.id FROM users ou WHERE ou.id = c.created_by AND ou.deleted_at IS NULL) AS created_by,
          c.company_id AS context_company_id,
          c.general_access,
          (SELECT COALESCE(ou.display_name, ou.username) FROM users ou
            WHERE ou.id = c.created_by AND ou.deleted_at IS NULL) AS owner_name,
          (SELECT l.key FROM access_control.context_user_access a
             JOIN access_control.access_levels l ON l.id = a.access_level_id
            WHERE a.connection_id = c.id AND a.user_id = ${actor.id}::uuid) AS granted_level,
          (SELECT l.key FROM ${MEMBER_GROUP_GRANTS}
             JOIN access_control.access_levels l ON l.id = ga.access_level_id
            WHERE ga.connection_id = c.id AND gu.user_id = ${actor.id}::uuid
            ORDER BY l.rank DESC
            LIMIT 1) AS group_level,
          (SELECT l.key FROM access_control.context_company_access ca
             JOIN access_control.access_levels l ON l.id = ca.access_level_id
            WHERE ca.connection_id = c.id AND ca.company_id = ${actor.companyId}::uuid) AS company_level,
          ((SELECT COUNT(*)::int FROM access_control.context_user_access sa
              JOIN users su ON su.id = sa.user_id AND su.deleted_at IS NULL
             WHERE sa.connection_id = c.id)
           + (SELECT COUNT(*)::int FROM access_control.context_group_access sg
                JOIN groups sgr ON sgr.id = sg.group_id AND sgr.deleted_at IS NULL
               WHERE sg.connection_id = c.id)
           + (SELECT COUNT(*)::int FROM access_control.context_company_access sc
                JOIN companies sco ON sco.id = sc.company_id AND sco.deleted_at IS NULL
               WHERE sc.connection_id = c.id)) AS shared_count`;
}

function contextScope(actor: Pick<Actor, 'companyId' | 'isPlatform'>): Prisma.Sql {
  if (actor.isPlatform) return Prisma.sql`TRUE`;
  return Prisma.sql`(c.company_id = ${actor.companyId}::uuid OR c.company_id IS NULL)`;
}

function visibleClause(actor: AccessActor, seeAll: boolean): Prisma.Sql {
  if (actor.isPlatform) return Prisma.sql`c.deleted_at IS NULL`;
  const shared = Prisma.sql`(EXISTS (SELECT 1 FROM access_control.context_user_access a
                       WHERE a.connection_id = c.id AND a.user_id = ${actor.id}::uuid)
           OR EXISTS (SELECT 1 FROM ${MEMBER_GROUP_GRANTS}
                       WHERE ga.connection_id = c.id AND gu.user_id = ${actor.id}::uuid))`;
  const ownCompany = seeAll
    ? Prisma.sql`TRUE`
    : Prisma.sql`(c.created_by = ${actor.id}::uuid OR c.general_access = 'company' OR ${shared})`;
  return Prisma.sql`(c.deleted_at IS NULL AND (
           (c.company_id = ${actor.companyId}::uuid AND ${ownCompany})
           OR (c.company_id IS NULL AND (${shared}
                OR EXISTS (SELECT 1 FROM access_control.context_company_access ca
                            WHERE ca.connection_id = c.id AND ca.company_id = ${actor.companyId}::uuid)))))`;
}

async function listGrants(connectionId: string): Promise<GrantRow[]> {
  return rawRows<GrantRow>(
    prisma,
    Prisma.sql`SELECT a.user_id, l.key AS access_level, a.access_level_id, a.granted_at,
            u.username, u.email, u.display_name, u.status, co.name AS company_name
       FROM access_control.context_user_access a
       JOIN access_control.access_levels l ON l.id = a.access_level_id
       JOIN users u ON u.id = a.user_id AND u.deleted_at IS NULL
       LEFT JOIN companies co ON co.id = u.company_id
      WHERE a.connection_id = ${connectionId}::uuid
      ORDER BY COALESCE(u.display_name, u.username)`
  );
}

async function shareablePeople(companyId: string | null, ownerId: string | null): Promise<PersonRow[]> {
  const inScope =
    companyId === null
      ? Prisma.sql`co.deleted_at IS NULL AND co.active`
      : Prisma.sql`u.company_id = ${companyId}::uuid`;
  return rawRows<PersonRow>(
    prisma,
    Prisma.sql`SELECT u.id, u.username, u.email, u.display_name, co.name AS company_name
       FROM users u
       JOIN companies co ON co.id = u.company_id
      WHERE ${inScope} AND u.status = 'active' AND u.deleted_at IS NULL
        AND u.id IS DISTINCT FROM ${ownerId}::uuid
      ORDER BY lower(co.name), COALESCE(u.display_name, u.username)`
  );
}

async function findActiveCompanyUser(companyId: string | null, userId: string): Promise<PersonRow | null> {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      status: 'active',
      ...NOT_DELETED,
      ...(companyId === null ? { company: { active: true, ...NOT_DELETED } } : { companyId }),
    },
    select: { id: true, username: true, email: true, displayName: true, company: { select: { name: true } } },
  });
  return user
    ? {
        id: user.id,
        username: user.username,
        email: user.email,
        display_name: user.displayName,
        company_name: user.company?.name ?? null,
      }
    : null;
}

async function findGrant(connectionId: string, userId: string): Promise<string | null> {
  const grant = await prisma.contextUserAccess.findUnique({
    where: { connectionId_userId: { connectionId, userId } },
    select: { accessLevel: { select: { key: true } } },
  });
  return grant ? grant.accessLevel.key : null;
}

async function upsertGrant(connectionId: string, userId: string, level: string, grantedBy: string): Promise<void> {
  const accessLevelId = contextLevel(level);
  await prisma.contextUserAccess.upsert({
    where: { connectionId_userId: { connectionId, userId } },
    create: { connectionId, userId, accessLevelId, grantedBy },
    update: { accessLevelId, grantedBy, grantedAt: new Date() },
  });
}

async function deleteGrant(connectionId: string, userId: string): Promise<boolean> {
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
        select: {
          name: true,
          active: true,
          company: { select: { name: true } },
          _count: { select: { members: { where: { user: NOT_DELETED } } } },
        },
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
    company_name: g.group.company?.name ?? null,
  }));
}

async function shareableGroups(companyId: string | null): Promise<ShareableGroupRow[]> {
  const groups = await prisma.group.findMany({
    where: {
      active: true,
      ...NOT_DELETED,
      ...(companyId === null ? { company: { active: true, ...NOT_DELETED } } : { companyId }),
    },
    select: {
      id: true,
      name: true,
      company: { select: { name: true } },
      _count: { select: { members: { where: { user: NOT_DELETED } } } },
    },
    orderBy: [{ company: { name: 'asc' } }, { name: 'asc' }],
  });
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    member_count: g._count.members,
    company_name: g.company?.name ?? null,
  }));
}

async function findActiveCompanyGroup(
  companyId: string | null,
  groupId: string
): Promise<{ id: string; name: string } | null> {
  return prisma.group.findFirst({
    where: {
      id: groupId,
      active: true,
      ...NOT_DELETED,
      ...(companyId === null ? { company: { active: true, ...NOT_DELETED } } : { companyId }),
    },
    select: { id: true, name: true },
  });
}

async function listCompanyGrants(connectionId: string): Promise<CompanyGrantRow[]> {
  return rawRows<CompanyGrantRow>(
    prisma,
    Prisma.sql`SELECT ca.company_id, l.key AS access_level, ca.access_level_id, ca.granted_at,
            co.name, co.active, ${COMPANY_MEMBERS} AS member_count
       FROM access_control.context_company_access ca
       JOIN access_control.access_levels l ON l.id = ca.access_level_id
       JOIN companies co ON co.id = ca.company_id AND co.deleted_at IS NULL
      WHERE ca.connection_id = ${connectionId}::uuid
      ORDER BY lower(co.name)`
  );
}

async function shareableCompanies(): Promise<ShareableCompanyRow[]> {
  return rawRows<ShareableCompanyRow>(
    prisma,
    Prisma.sql`SELECT co.id, co.name, ${COMPANY_MEMBERS} AS member_count
       FROM companies co
      WHERE co.deleted_at IS NULL AND co.active
      ORDER BY lower(co.name)`
  );
}

async function findActiveCompany(companyId: string): Promise<{ id: string; name: string } | null> {
  return prisma.company.findFirst({
    where: { id: companyId, active: true, ...NOT_DELETED },
    select: { id: true, name: true },
  });
}

async function findCompanyGrant(connectionId: string, companyId: string): Promise<string | null> {
  const grant = await prisma.contextCompanyAccess.findUnique({
    where: { connectionId_companyId: { connectionId, companyId } },
    select: { accessLevel: { select: { key: true } } },
  });
  return grant ? grant.accessLevel.key : null;
}

async function upsertCompanyGrant(
  connectionId: string,
  companyId: string,
  level: string,
  grantedBy: string
): Promise<void> {
  const accessLevelId = contextLevel(level);
  await prisma.contextCompanyAccess.upsert({
    where: { connectionId_companyId: { connectionId, companyId } },
    create: { connectionId, companyId, accessLevelId, grantedBy },
    update: { accessLevelId, grantedBy, grantedAt: new Date() },
  });
}

async function deleteCompanyGrant(connectionId: string, companyId: string): Promise<boolean> {
  const result = await prisma.contextCompanyAccess.deleteMany({ where: { connectionId, companyId } });
  return result.count > 0;
}

async function findGroupGrant(connectionId: string, groupId: string): Promise<string | null> {
  const grant = await prisma.contextGroupAccess.findUnique({
    where: { connectionId_groupId: { connectionId, groupId } },
    select: { accessLevel: { select: { key: true } } },
  });
  return grant ? grant.accessLevel.key : null;
}

async function upsertGroupGrant(
  connectionId: string,
  groupId: string,
  level: string,
  grantedBy: string
): Promise<void> {
  const accessLevelId = contextLevel(level);
  await prisma.contextGroupAccess.upsert({
    where: { connectionId_groupId: { connectionId, groupId } },
    create: { connectionId, groupId, accessLevelId, grantedBy },
    update: { accessLevelId, grantedBy, grantedAt: new Date() },
  });
}

async function deleteGroupGrant(connectionId: string, groupId: string): Promise<boolean> {
  const result = await prisma.contextGroupAccess.deleteMany({ where: { connectionId, groupId } });
  return result.count > 0;
}

async function listContextsForGroup(groupId: string): Promise<GroupContextRow[]> {
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
  contextScope,
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
  listCompanyGrants,
  shareableCompanies,
  findActiveCompany,
  findCompanyGrant,
  upsertCompanyGrant,
  deleteCompanyGrant,
};
export type {
  AccessColumnsRow,
  GrantRow,
  PersonRow,
  GroupGrantRow,
  ShareableGroupRow,
  GroupContextRow,
  CompanyGrantRow,
  ShareableCompanyRow,
};
