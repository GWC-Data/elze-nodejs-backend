import { fail } from '../../shared/errors/AppError';
import { can } from '../auth/authorizationService';
import { accessLevelKeys, levelRank } from '../catalogue/catalogueService';
import type { ContextAccessLevel } from './contextConstants';
import type { AccessColumnsRow } from './contextAccessRepository';
import type { Actor } from '../../shared/types/actor';
import type { GeneralAccess } from '../../generated/prisma/enums';

type OwnerRow = Pick<AccessColumnsRow, 'created_by' | 'context_company_id'>;

interface ContextAccess {
  level: ContextAccessLevel;
  owner: { id: string; name: string | null } | null;
  isOwner: boolean;
  canShare: boolean;
  generalAccess: GeneralAccess;
  sharedWith: number;
}

function isContextAdmin(actor: Actor): boolean {
  return actor.isPlatform || can(actor, 'context.manage_all');
}

function administers(actor: Actor, row: Pick<AccessColumnsRow, 'context_company_id'>): boolean {
  if (actor.isPlatform) return true;
  return row.context_company_id !== null && row.context_company_id === actor.companyId && isContextAdmin(actor);
}

function isPlatformContext(row: Pick<AccessColumnsRow, 'context_company_id'>): boolean {
  return row.context_company_id === null;
}

function ownerIdOf(row: OwnerRow): string | null {
  return row.created_by ?? null;
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
  if (administers(actor, row)) return 'full';
  if (ownerIdOf(row) === actor.id) return 'full';
  const sameCompany = row.context_company_id !== null && row.context_company_id === actor.companyId;
  if (!sameCompany && !isPlatformContext(row)) return null;
  return strongest(
    row.granted_level,
    row.group_level,
    isPlatformContext(row) ? row.company_level : null,
    sameCompany && row.general_access === 'company' ? 'view' : null
  );
}

function levelAtLeast(level: ContextAccessLevel | null, required: ContextAccessLevel): boolean {
  return Boolean(level) && levelRank('context', level) >= levelRank('context', required);
}

function mayShare(actor: Actor, row: OwnerRow): boolean {
  if (isPlatformContext(row)) return actor.isPlatform;
  return administers(actor, row) || ownerIdOf(row) === actor.id;
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
    sharedWith: Number(row.shared_count ?? 0),
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
    throw fail(
      'INSUFFICIENT_PERMISSION',
      isPlatformContext(row)
        ? 'Only platform accounts can share a platform context.'
        : 'Only the person who created this context, or a company admin, can share it.'
    );
  }
}

export { isContextAdmin, isPlatformContext, levelOf, levelAtLeast, mayShare, accessOf, assertLevel, assertMayShare };
export type { ContextAccess };
