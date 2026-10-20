import { fail } from '../../shared/errors/AppError';
import { can } from '../auth/authorizationService';
import { accessLevelKeys, levelRank } from '../catalogue/catalogueService';
import type { ContextAccessLevel } from './contextConstants';
import type { AccessColumnsRow } from './contextAccessRepository';
import type { Actor } from '../../shared/types/actor';
import type { GeneralAccess } from '../../generated/prisma/enums';

type OwnerRow = Pick<AccessColumnsRow, 'created_by'>;

interface ContextAccess {
  level: ContextAccessLevel;
  owner: { id: number; name: string | null } | null;
  isOwner: boolean;
  canShare: boolean;
  generalAccess: GeneralAccess;
}

function isContextAdmin(actor: Actor): boolean {
  return actor.isPlatform || can(actor, 'context.manage_all');
}

function ownerIdOf(row: OwnerRow): number | null {
  return row.created_by === null || row.created_by === undefined ? null : Number(row.created_by);
}

function isContextLevel(level: string | null, known: readonly string[]): level is ContextAccessLevel {
  return level !== null && known.includes(level);
}

function strongest(...levels: (string | null)[]): ContextAccessLevel | null {
  let best: ContextAccessLevel | null = null;
  const known = accessLevelKeys('context');
  for (const level of levels) {
    if (!isContextLevel(level, known)) continue;
    if (!best || levelRank('context', level) > levelRank('context', best)) best = level;
  }
  return best;
}

function levelOf(actor: Actor, row: AccessColumnsRow): ContextAccessLevel | null {
  if (isContextAdmin(actor)) return 'full';
  if (ownerIdOf(row) === actor.id) return 'full';
  return strongest(row.granted_level, row.group_level, row.general_access === 'company' ? 'view' : null);
}

function levelAtLeast(level: ContextAccessLevel | null, required: ContextAccessLevel): boolean {
  return Boolean(level) && levelRank('context', level) >= levelRank('context', required);
}

function mayShare(actor: Actor, row: OwnerRow): boolean {
  const ownerId = ownerIdOf(row);
  return ownerId === null ? isContextAdmin(actor) : ownerId === actor.id;
}

function accessOf(actor: Actor, row: AccessColumnsRow): ContextAccess | null {
  const level = levelOf(actor, row);
  if (!level) return null;
  const ownerId = ownerIdOf(row);
  return {
    level,
    owner: ownerId === null ? null : { id: ownerId, name: row.owner_name ?? null },
    isOwner: ownerId !== null && ownerId === actor.id,
    canShare: mayShare(actor, row),
    generalAccess: row.general_access,
  };
}

const NEEDS: Record<ContextAccessLevel, string> = {
  view: 'view',
  edit: 'change',
  full: 'delete',
};

function assertLevel(
  actor: Actor,
  row: AccessColumnsRow,
  required: ContextAccessLevel,
  notFound: string
): ContextAccess {
  const access = accessOf(actor, row);
  if (!access) throw fail('RESOURCE_NOT_FOUND', notFound);
  if (!levelAtLeast(access.level, required)) {
    throw fail('INSUFFICIENT_PERMISSION', `Your access to this context does not let you ${NEEDS[required]} it.`);
  }
  return access;
}

function assertMayShare(actor: Actor, row: OwnerRow): void {
  if (!mayShare(actor, row)) {
    throw fail('INSUFFICIENT_PERMISSION', 'Only the person who created this context can share it.');
  }
}

export { isContextAdmin, levelOf, levelAtLeast, mayShare, accessOf, assertLevel, assertMayShare };
export type { ContextAccess };
