import * as contextAccessRepository from '../repositories/contextAccessRepository';
import { fail } from '../tools/AppError';
import { requireId } from '../validators/commonValidator';
import { CONTEXT_ACCESS_LEVELS, GENERAL_ACCESS } from '../constants/context';
import type { ContextAccessLevel, GeneralAccess } from '../constants/context';
import * as connections from './connectionService';
import { assertMayShare } from './contextAccessService';
import { audit, EVENTS } from './auditService';
import type { Actor } from '../types/actor';

type Row = Record<string, any>;
type Connection = Awaited<ReturnType<typeof connections.requireConnectionId>>;

function shapePerson(row: Row) {
  return {
    userId: Number(row.user_id ?? row.id),
    username: row.username,
    email: row.email,
    displayName: row.display_name || null,
  };
}

function onContext(connection: Connection): Record<string, unknown> {
  return { connectionId: connection.id, connectionName: connection.name, companyId: connection.companyId };
}

function requireContextLevel(value: unknown): ContextAccessLevel {
  const level = String(value || '') as ContextAccessLevel;
  if (!CONTEXT_ACCESS_LEVELS.includes(level)) {
    throw fail('VALIDATION_ERROR', `Access must be one of: ${CONTEXT_ACCESS_LEVELS.join(', ')}.`);
  }
  return level;
}

function requireGeneralAccess(value: unknown): GeneralAccess {
  const general = String(value || '') as GeneralAccess;
  if (!GENERAL_ACCESS.includes(general)) {
    throw fail('VALIDATION_ERROR', `General access must be one of: ${GENERAL_ACCESS.join(', ')}.`);
  }
  return general;
}

async function describe(connection: Connection): Promise<Record<string, any>> {
  const grants = await contextAccessRepository.listGrants(connection.id);
  const { level, owner, isOwner, canShare, generalAccess } = connection.access;
  return {
    owner,
    generalAccess,
    people: grants.map((row: Row) => ({
      ...shapePerson(row),
      level: row.access_level,
      grantedAt: row.granted_at,
      active: row.status === 'active',
    })),
    you: { level, isOwner, canShare },
  };
}

async function contextAccess(actor: Actor, id: unknown): Promise<Record<string, any>> {
  return describe(await connections.requireConnectionId(actor, id));
}

async function shareablePeople(actor: Actor, id: unknown): Promise<Record<string, any>[]> {
  const connection = await connections.requireConnectionId(actor, id);
  assertMayShare(actor, connection.row);
  const rows = await contextAccessRepository.shareablePeople(
    connection.companyId,
    connection.access.owner?.id ?? null
  );
  return rows.map(shapePerson);
}

async function shareWithUser(actor: Actor, id: unknown, rawUserId: unknown, body: Record<string, any> = {}): Promise<Record<string, any>> {
  const connection = await connections.requireConnectionId(actor, id);
  assertMayShare(actor, connection.row);
  const userId = requireId(rawUserId, 'user id');
  const level = requireContextLevel(body.level);

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
    previousLevel: previous,
  });
  return describe(await connections.requireConnectionId(actor, id));
}

async function unshareWithUser(actor: Actor, id: unknown, rawUserId: unknown): Promise<Record<string, any>> {
  const connection = await connections.requireConnectionId(actor, id);
  assertMayShare(actor, connection.row);
  const userId = requireId(rawUserId, 'user id');

  const previous = await contextAccessRepository.findGrant(connection.id, userId);
  if (await contextAccessRepository.deleteGrant(connection.id, userId)) {
    audit(EVENTS.CONTEXT_ACCESS_REVOKED, actor, { ...onContext(connection), userId, previousLevel: previous });
  }
  return describe(await connections.requireConnectionId(actor, id));
}

async function setGeneralAccess(actor: Actor, id: unknown, body: Record<string, any> = {}): Promise<Record<string, any>> {
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

export { contextAccess, shareablePeople, shareWithUser, unshareWithUser, setGeneralAccess };
