import config from '../config';
import * as groupRepository from '../repositories/groupRepository';
import { fail } from '../tools/AppError';
import { requireString, requireArray } from '../validators/commonValidator';
import { shapeGroup } from '../views/serializers/groupSerializer';
import { resolveTargetCompany } from './authorizationService';
import { requireCompany } from './companyService';
import { audit, EVENTS } from './auditService';
import { UNIQUE_VIOLATION } from '../constants/pgErrors';
import type { Actor } from '../types/actor';
import type { Queryable } from '../config/pgPool';

const { withTransaction } = config.database;

const DUPLICATE_NAME = 'A group with that name already exists in this company.';

interface GroupRecord {
  id: number;
  companyId: number;
  name: string;
  [key: string]: any;
}

interface GroupFields {
  name?: unknown;
  active?: unknown;
  userIds?: unknown[];
  companyId?: unknown;
}

async function listGroups(actor: Actor) {
  const rows = await groupRepository.list(actor);
  return rows.map(shapeGroup);
}

async function requireGroupInScope(actor: Actor, id: number) {
  const row = await groupRepository.findInScope(actor, id);
  if (!row) throw fail('RESOURCE_NOT_FOUND', 'Group not found');
  return shapeGroup(row) as unknown as GroupRecord;
}

async function writeMembers(conn: Queryable, group: { id: number; companyId: number }, userIds: unknown[]): Promise<void> {
  const unique = [...new Set(userIds.map(Number))];
  if (unique.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw fail('VALIDATION_ERROR', 'userIds must be positive integers');
  }

  await groupRepository.clearMembers(conn, group.id);
  if (!unique.length) return;

  const found: number[] = await groupRepository.usersInCompany(conn, unique, group.companyId);
  if (found.length !== unique.length) {
    const known = new Set(found);
    const rejected = unique.filter((id) => !known.has(id));
    throw fail(
      'VALIDATION_ERROR',
      `These accounts are not in this company: ${rejected.join(', ')}`,
      { userIds: rejected }
    );
  }

  await groupRepository.insertMembers(conn, group.id, unique);
}

async function uniqueName<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err: any) {
    if (err.code === UNIQUE_VIOLATION) throw fail('CONFLICT', DUPLICATE_NAME);
    throw err;
  }
}

async function createGroup(actor: Actor, { name, active = true, userIds = [], companyId: requestedCompanyId }: GroupFields) {
  const groupName = requireString(name, 'Group name', { max: 100 });
  requireArray(userIds, 'userIds must be an array');

  const companyId = resolveTargetCompany(actor, requestedCompanyId);
  await requireCompany(actor, companyId);

  const id = await uniqueName(() =>
    withTransaction(async (conn: Queryable) => {
      const groupId = await groupRepository.insert(conn, {
        companyId,
        name: groupName,
        active: Boolean(active),
        creatorId: actor.id,
      });
      await writeMembers(conn, { id: groupId, companyId }, userIds);
      return groupId;
    })
  );

  audit(EVENTS.GROUP_CREATED, actor, {
    groupId: id,
    name: groupName,
    companyId,
    memberCount: userIds.length,
  });
  return requireGroupInScope(actor, id);
}

async function describeGroup(actor: Actor, id: number) {
  const group = await requireGroupInScope(actor, id);
  return { ...group, userIds: await groupRepository.memberIds(group.id) };
}

async function updateGroup(actor: Actor, id: number, { name, active, userIds }: GroupFields) {
  const group = await requireGroupInScope(actor, id);

  if (userIds !== undefined) requireArray(userIds, 'userIds must be an array');

  const updates: string[] = [];
  const params: unknown[] = [];
  if (name !== undefined) {
    updates.push('name = ?');
    params.push(requireString(name, 'Group name', { max: 100 }));
  }
  if (typeof active === 'boolean') {
    updates.push('active = ?');
    params.push(active);
  }
  if (!updates.length && userIds === undefined) throw fail('VALIDATION_ERROR', 'Nothing to update');

  await uniqueName(() =>
    withTransaction(async (conn: Queryable) => {
      if (updates.length) await groupRepository.updateColumns(conn, id, updates, params);
      if (Array.isArray(userIds)) await writeMembers(conn, group, userIds);
    })
  );

  audit(EVENTS.GROUP_UPDATED, actor, {
    groupId: id,
    name: group.name,
    companyId: group.companyId,
    membershipReplaced: Array.isArray(userIds),
  });
  return requireGroupInScope(actor, id);
}

async function deleteGroup(actor: Actor, id: number): Promise<void> {
  const group = await requireGroupInScope(actor, id);
  await groupRepository.remove(id);
  audit(EVENTS.GROUP_DELETED, actor, { groupId: id, name: group.name, companyId: group.companyId });
}

async function listMembers(actor: Actor, id: number) {
  const group = await requireGroupInScope(actor, id);
  return groupRepository.listMembers(group.id);
}

export {
  listGroups,
  requireGroupInScope,
  createGroup,
  describeGroup,
  updateGroup,
  deleteGroup,
  listMembers,
};
