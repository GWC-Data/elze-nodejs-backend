import { fail } from '../tools/AppError';
import { can } from './authorizationService';
import { CONTEXT_ACCESS_LEVELS, CONTEXT_LEVEL_RANK } from '../constants/context';
import type { ContextAccessLevel } from '../constants/context';
import type { Actor } from '../types/actor';

type Row = Record<string, any>;

interface ContextAccess {
  level: ContextAccessLevel;
  owner: { id: number; name: string | null } | null;
  isOwner: boolean;
  canShare: boolean;
  generalAccess: string;
}

function isContextAdmin(actor: Actor): boolean {
  return actor.isPlatform || can(actor, 'context.manage_all');
}

function ownerIdOf(row: Row): number | null {
  return row.created_by === null || row.created_by === undefined ? null : Number(row.created_by);
}

function levelOf(actor: Actor, row: Row): ContextAccessLevel | null {
  if (isContextAdmin(actor)) return 'full';
  if (ownerIdOf(row) === actor.id) return 'full';
  if (CONTEXT_ACCESS_LEVELS.includes(row.granted_level)) return row.granted_level;
  if (row.general_access === 'company') return 'view';
  return null;
}

function levelAtLeast(level: ContextAccessLevel | null, required: ContextAccessLevel): boolean {
  return Boolean(level) && CONTEXT_LEVEL_RANK[level!] >= CONTEXT_LEVEL_RANK[required];
}

function mayShare(actor: Actor, row: Row): boolean {
  const ownerId = ownerIdOf(row);
  return ownerId === null ? isContextAdmin(actor) : ownerId === actor.id;
}

function accessOf(actor: Actor, row: Row): ContextAccess | null {
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

function assertLevel(actor: Actor, row: Row, required: ContextAccessLevel, notFound: string): ContextAccess {
  const access = accessOf(actor, row);
  if (!access) throw fail('RESOURCE_NOT_FOUND', notFound);
  if (!levelAtLeast(access.level, required)) {
    throw fail('INSUFFICIENT_PERMISSION', `Your access to this context does not let you ${NEEDS[required]} it.`);
  }
  return access;
}

function assertMayShare(actor: Actor, row: Row): void {
  if (!mayShare(actor, row)) {
    throw fail('INSUFFICIENT_PERMISSION', 'Only the person who created this context can share it.');
  }
}

export { isContextAdmin, levelOf, levelAtLeast, mayShare, accessOf, assertLevel, assertMayShare };
export type { ContextAccess };
