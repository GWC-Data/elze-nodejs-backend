import config from '../../config';
import type { Prisma } from '../../generated/prisma/client';
import { NOT_DELETED, softDeletion } from '../../shared/db/softDelete';
import type { Tx } from '../../shared/db/database';
import type { Actor } from '../../shared/types/actor';

const { prisma } = config.database;

const GROUP_INCLUDE = {
  company: { select: { name: true } },
  _count: { select: { members: { where: { user: NOT_DELETED } } } },
} as const;

interface GroupView {
  id: number;
  companyId: number;
  companyName: string;
  name: string;
  active: boolean;
  createdAt: Date;
  memberCount: number;
}

function shape(row: Prisma.GroupGetPayload<{ include: typeof GROUP_INCLUDE }>): GroupView {
  return {
    id: row.id,
    companyId: row.companyId,
    companyName: row.company.name,
    name: row.name,
    active: row.active,
    createdAt: row.createdAt,
    memberCount: row._count.members,
  };
}

function scopeWhere(actor: Actor, { includeDeleted = false }: { includeDeleted?: boolean } = {}) {
  const live = includeDeleted ? {} : NOT_DELETED;
  return actor.isPlatform ? live : { companyId: actor.companyId as number, ...live };
}

async function list(actor: Actor): Promise<GroupView[]> {
  const rows = await prisma.group.findMany({
    where: scopeWhere(actor),
    include: GROUP_INCLUDE,
    orderBy: [{ company: { name: 'asc' } }, { name: 'asc' }],
  });
  return rows.map(shape);
}

async function findInScope(
  actor: Actor,
  id: unknown,
  { includeDeleted = false }: { includeDeleted?: boolean } = {}
): Promise<GroupView | null> {
  const groupId = Number(id);
  if (!Number.isSafeInteger(groupId)) return null;
  const row = await prisma.group.findFirst({
    where: { id: groupId, ...scopeWhere(actor, { includeDeleted }) },
    include: GROUP_INCLUDE,
  });
  return row ? shape(row) : null;
}

async function memberIds(groupId: number): Promise<number[]> {
  const rows = await prisma.groupUser.findMany({ where: { groupId, user: NOT_DELETED }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

async function listMembers(groupId: number) {
  const rows = await prisma.groupUser.findMany({
    where: { groupId, user: NOT_DELETED },
    include: { user: { include: { role: { include: { role: { select: { tier: true } } } } } } },
    orderBy: { user: { username: 'asc' } },
  });
  return rows.map(({ user }) => ({
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role ? user.role.role.tier : null,
    status: user.status,
  }));
}

async function clearMembers(tx: Tx, groupId: number): Promise<void> {
  await tx.groupUser.deleteMany({ where: { groupId } });
}

async function usersInCompany(tx: Tx, userIds: readonly number[], companyId: number | null): Promise<number[]> {
  if (companyId === null) return [];
  const rows = await tx.user.findMany({
    where: { id: { in: [...userIds] }, companyId, ...NOT_DELETED },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function insertMembers(tx: Tx, groupId: number, userIds: readonly number[]): Promise<void> {
  await tx.groupUser.createMany({ data: userIds.map((userId) => ({ groupId, userId })) });
}

async function insert(
  tx: Tx,
  { companyId, name, active, creatorId }: { companyId: number; name: string; active: boolean; creatorId: number | null }
): Promise<number> {
  const row = await tx.group.create({ data: { companyId, name, active, creatorId }, select: { id: true } });
  return row.id;
}

async function updateColumns(tx: Tx, id: number, changes: { name?: string; active?: boolean }): Promise<void> {
  await tx.group.update({ where: { id }, data: changes });
}

async function discard(id: number): Promise<void> {
  await prisma.group.deleteMany({ where: { id } });
}

async function softDelete(id: number, deletedBy: number | null): Promise<boolean> {
  const result = await prisma.group.updateMany({
    where: { id, ...NOT_DELETED },
    data: { ...softDeletion(deletedBy), active: false },
  });
  return result.count > 0;
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
  softDelete,
  discard,
};
export type { GroupView };
