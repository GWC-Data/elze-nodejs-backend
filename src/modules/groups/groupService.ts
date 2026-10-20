import config from '../../config';
import * as groupRepository from './groupRepository';
import * as contextAccessRepository from '../contextLayer/contextAccessRepository';
import { fail } from '../../shared/errors/AppError';
import { requireString, requireArray } from '../../shared/validation/commonValidator';
import { shapeGroup } from './groupSerializer';
import { resolveTargetCompany } from '../auth/authorizationService';
import { requireCompany } from '../companies/companyService';
import { audit, EVENTS } from '../audit/auditService';
import { UNIQUE_VIOLATION } from '../../shared/errors/pgErrors';
import { sqlState } from '../../shared/db/dbError';
import type { Actor } from '../../shared/types/actor';
import type { Tx } from '../../shared/db/database';

const { withTransaction } = config.database;

const DUPLICATE_NAME = 'A group with that name already exists in this company.';

interface GroupFields {
  name?: unknown;
  active?: unknown;
  userIds?: unknown;
  companyId?: unknown;
}

async function listGroups(actor: Actor) {
  const rows = await groupRepository.list(actor);
  return rows.map((row) => shapeGroup(row));
}

async function requireGroupInScope(actor: Actor, id: number) {
  const row = await groupRepository.findInScope(actor, id);
  if (!row) throw fail('RESOURCE_NOT_FOUND', 'Group not found');
  return shapeGroup(row);
}

async function writeMembers(conn: Tx, group: { id: number; companyId: number }, userIds: unknown[]): Promise<void> {
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
    throw fail('VALIDATION_ERROR', `These accounts are not in this company: ${rejected.join(', ')}`, {
      userIds: rejected,
    });
  }

  await groupRepository.insertMembers(conn, group.id, unique);
}

async function uniqueName<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (sqlState(err) === UNIQUE_VIOLATION) throw fail('CONFLICT', DUPLICATE_NAME);
    throw err;
  }
}

async function createGroup(
  actor: Actor,
  { name, active = true, userIds = [], companyId: requestedCompanyId }: GroupFields
) {
  const groupName = requireString(name, 'Group name', { max: 100 });
  const members = requireArray(userIds, 'userIds must be an array');

  const companyId = resolveTargetCompany(actor, requestedCompanyId);
  await requireCompany(actor, companyId);

  const id = await uniqueName(() =>
    withTransaction(async (conn: Tx) => {
      const groupId = await groupRepository.insert(conn, {
        companyId,
        name: groupName,
        active: Boolean(active),
        creatorId: actor.id,
      });
      await writeMembers(conn, { id: groupId, companyId }, members);
      return groupId;
    })
  );

  audit(EVENTS.GROUP_CREATED, actor, {
    groupId: id,
    name: groupName,
    companyId,
    memberCount: members.length,
  });
  return requireGroupInScope(actor, id);
}

async function describeGroup(actor: Actor, id: number) {
  const group = await requireGroupInScope(actor, id);
  return { ...group, userIds: await groupRepository.memberIds(group.id) };
}

async function updateGroup(actor: Actor, id: number, { name, active, userIds }: GroupFields) {
  const group = await requireGroupInScope(actor, id);

  const members = userIds === undefined ? undefined : requireArray(userIds, 'userIds must be an array');

  const changes: { name?: string; active?: boolean } = {};
  if (name !== undefined) changes.name = requireString(name, 'Group name', { max: 100 });
  if (typeof active === 'boolean') changes.active = active;
  const hasChanges = Object.keys(changes).length > 0;
  if (!hasChanges && userIds === undefined) throw fail('VALIDATION_ERROR', 'Nothing to update');

  await uniqueName(() =>
    withTransaction(async (conn: Tx) => {
      if (hasChanges) await groupRepository.updateColumns(conn, id, changes);
      if (members) await writeMembers(conn, group, members);
    })
  );

  audit(EVENTS.GROUP_UPDATED, actor, {
    groupId: id,
    name: group.name,
    companyId: group.companyId,
    membershipReplaced: members !== undefined,
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

async function listGroupContexts(actor: Actor, id: number) {
  const group = await requireGroupInScope(actor, id);
  const rows = await contextAccessRepository.listContextsForGroup(group.id);
  return rows.map((row) => ({
    connectionId: row.connection_id,
    connectionName: row.name,
    provider: row.provider,
    name: row.published_name || row.name,
    publishedVersion: row.published_version === null ? null : Number(row.published_version),
    level: row.access_level,
    levelId: row.access_level_id,
    grantedAt: row.granted_at,
  }));
}

export {
  listGroups,
  requireGroupInScope,
  createGroup,
  describeGroup,
  updateGroup,
  deleteGroup,
  listMembers,
  listGroupContexts,
};
