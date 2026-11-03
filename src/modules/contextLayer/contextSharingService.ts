import * as contextAccessRepository from './contextAccessRepository';
import { fail } from '../../shared/errors/AppError';
import { requireUuid } from '../../shared/validation/commonValidator';
import { GENERAL_ACCESS } from './contextConstants';
import type { ContextAccessLevel, GeneralAccess } from './contextConstants';
import { accessLevelsFor, accessLevelId } from '../catalogue/catalogueService';
import { requireLevelId } from '../access/accessValidator';
import * as connections from './connectionService';
import { assertMayShare } from './contextAccessService';
import { audit, EVENTS } from '../audit/auditService';
import type { Actor } from '../../shared/types/actor';
import type { ConnectionRef } from './connectionService';
import type { ContextAccess } from './contextAccessService';
import type { RequestBody } from './contextTypes';

type Connection = ConnectionRef;

interface PersonSource {
  user_id?: string;
  id?: string;
  username: string;
  email: string;
  display_name: string | null;
}

interface GroupSource {
  group_id?: string;
  id?: string;
  name: string;
  member_count?: number;
}

interface SharedPerson {
  userId: string;
  username: string;
  email: string;
  displayName: string | null;
}

interface SharedGroup {
  groupId: string;
  name: string;
  memberCount: number;
}

interface ContextLevel {
  id: string;
  key: string;
  rank: number;
  label: string;
  description: string | null;
}

interface ContextSharing {
  owner: ContextAccess['owner'];
  generalAccess: ContextAccess['generalAccess'];
  levels: ContextLevel[];
  people: (SharedPerson & { level: string; levelId: string; grantedAt: Date; active: boolean })[];
  groups: (SharedGroup & { level: string; levelId: string; grantedAt: Date; active: boolean })[];
  you: { level: ContextAccess['level']; levelId: string | null; isOwner: boolean; canShare: boolean };
}

function shapePerson(row: PersonSource): SharedPerson {
  return {
    userId: String(row.user_id ?? row.id),
    username: row.username,
    email: row.email,
    displayName: row.display_name || null,
  };
}

function onContext(connection: Connection): Record<string, unknown> {
  return { connectionId: connection.id, connectionName: connection.name, companyId: connection.companyId };
}

function requireContextLevel(value: unknown): ContextAccessLevel {
  return requireLevelId(value, 'context') as ContextAccessLevel;
}

function describeContextLevels(): ContextLevel[] {
  return accessLevelsFor('context').map(({ id, key, rank, label, description }) => ({
    id,
    key,
    rank,
    label,
    description,
  }));
}

function requireGeneralAccess(value: unknown): GeneralAccess {
  const general = String(value || '') as GeneralAccess;
  if (!GENERAL_ACCESS.includes(general)) {
    throw fail('VALIDATION_ERROR', `General access must be one of: ${GENERAL_ACCESS.join(', ')}.`);
  }
  return general;
}

function shapeGroup(row: GroupSource): SharedGroup {
  return {
    groupId: String(row.group_id ?? row.id),
    name: row.name,
    memberCount: Number(row.member_count ?? 0),
  };
}

async function describe(connection: Connection): Promise<ContextSharing> {
  const [grants, groupGrants] = await Promise.all([
    contextAccessRepository.listGrants(connection.id),
    contextAccessRepository.listGroupGrants(connection.id),
  ]);
  const { level, owner, isOwner, canShare, generalAccess } = connection.access;
  return {
    owner,
    generalAccess,
    levels: describeContextLevels(),
    people: grants.map((row) => ({
      ...shapePerson(row),
      level: row.access_level,
      levelId: row.access_level_id,
      grantedAt: row.granted_at,
      active: row.status === 'active',
    })),
    groups: groupGrants.map((row) => ({
      ...shapeGroup(row),
      level: row.access_level,
      levelId: row.access_level_id,
      grantedAt: row.granted_at,
      active: Boolean(row.active),
    })),
    you: { level, levelId: level ? accessLevelId('context', level) : null, isOwner, canShare },
  };
}

async function contextAccess(actor: Actor, id: unknown): Promise<ContextSharing> {
  return describe(await connections.requireConnectionId(actor, id));
}

async function shareablePeople(actor: Actor, id: unknown): Promise<SharedPerson[]> {
  const connection = await connections.requireConnectionId(actor, id);
  assertMayShare(actor, connection.row);
  const rows = await contextAccessRepository.shareablePeople(connection.companyId, connection.access.owner?.id ?? null);
  return rows.map(shapePerson);
}

async function shareWithUser(
  actor: Actor,
  id: unknown,
  rawUserId: unknown,
  body: RequestBody = {}
): Promise<ContextSharing> {
  const connection = await connections.requireConnectionId(actor, id);
  assertMayShare(actor, connection.row);
  const userId = requireUuid(rawUserId, 'user id');
  const level = requireContextLevel(body.levelId);

  if (userId === connection.access.owner?.id) {
    throw fail('VALIDATION_ERROR', 'That person created this context, so they already have full access.');
  }
  const person = await contextAccessRepository.findActiveCompanyUser(connection.companyId, userId);
  if (!person) throw fail('RESOURCE_NOT_FOUND', 'User not found');

  const previous = await contextAccessRepository.findGrant(connection.id, userId);
  await contextAccessRepository.upsertGrant(connection.id, userId, level, actor.id);
  audit(previous ? EVENTS.CONTEXT_ACCESS_UPDATED : EVENTS.CONTEXT_ACCESS_GRANTED, actor, {
    ...onContext(connection),
    userId,
    level,
    levelId: accessLevelId('context', level),
    previousLevel: previous,
  });
  return describe(await connections.requireConnectionId(actor, id));
}

async function unshareWithUser(actor: Actor, id: unknown, rawUserId: unknown): Promise<ContextSharing> {
  const connection = await connections.requireConnectionId(actor, id);
  assertMayShare(actor, connection.row);
  const userId = requireUuid(rawUserId, 'user id');

  const previous = await contextAccessRepository.findGrant(connection.id, userId);
  if (await contextAccessRepository.deleteGrant(connection.id, userId)) {
    audit(EVENTS.CONTEXT_ACCESS_REVOKED, actor, { ...onContext(connection), userId, previousLevel: previous });
  }
  return describe(await connections.requireConnectionId(actor, id));
}

async function shareableGroups(actor: Actor, id: unknown): Promise<SharedGroup[]> {
  const connection = await connections.requireConnectionId(actor, id);
  assertMayShare(actor, connection.row);
  const rows = await contextAccessRepository.shareableGroups(connection.companyId);
  return rows.map(shapeGroup);
}

async function shareWithGroup(
  actor: Actor,
  id: unknown,
  rawGroupId: unknown,
  body: RequestBody = {}
): Promise<ContextSharing> {
  const connection = await connections.requireConnectionId(actor, id);
  assertMayShare(actor, connection.row);
  const groupId = requireUuid(rawGroupId, 'group id');
  const level = requireContextLevel(body.levelId);

  const group = await contextAccessRepository.findActiveCompanyGroup(connection.companyId, groupId);
  if (!group) throw fail('RESOURCE_NOT_FOUND', 'Group not found');

  const previous = await contextAccessRepository.findGroupGrant(connection.id, groupId);
  await contextAccessRepository.upsertGroupGrant(connection.id, groupId, level, actor.id);
  audit(previous ? EVENTS.CONTEXT_ACCESS_UPDATED : EVENTS.CONTEXT_ACCESS_GRANTED, actor, {
    ...onContext(connection),
    groupId,
    groupName: group.name,
    level,
    levelId: accessLevelId('context', level),
    previousLevel: previous,
  });
  return describe(await connections.requireConnectionId(actor, id));
}

async function unshareWithGroup(actor: Actor, id: unknown, rawGroupId: unknown): Promise<ContextSharing> {
  const connection = await connections.requireConnectionId(actor, id);
  assertMayShare(actor, connection.row);
  const groupId = requireUuid(rawGroupId, 'group id');

  const previous = await contextAccessRepository.findGroupGrant(connection.id, groupId);
  if (await contextAccessRepository.deleteGroupGrant(connection.id, groupId)) {
    audit(EVENTS.CONTEXT_ACCESS_REVOKED, actor, { ...onContext(connection), groupId, previousLevel: previous });
  }
  return describe(await connections.requireConnectionId(actor, id));
}

async function setGeneralAccess(actor: Actor, id: unknown, body: RequestBody = {}): Promise<ContextSharing> {
  const connection = await connections.requireConnectionId(actor, id);
  assertMayShare(actor, connection.row);
  const general = requireGeneralAccess(body.generalAccess);

  if (general !== connection.access.generalAccess) {
    await contextAccessRepository.setGeneralAccess(connection.id, general);
    audit(EVENTS.CONTEXT_ACCESS_UPDATED, actor, {
      ...onContext(connection),
      generalAccess: general,
      previousGeneralAccess: connection.access.generalAccess,
    });
  }
  return describe(await connections.requireConnectionId(actor, id));
}

export type { ContextSharing, SharedPerson, SharedGroup, ContextLevel };
export {
  contextAccess,
  shareablePeople,
  shareWithUser,
  unshareWithUser,
  shareableGroups,
  shareWithGroup,
  unshareWithGroup,
  setGeneralAccess,
};
