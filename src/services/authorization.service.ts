import { fail } from '../tools/AppError';
import {
  ROLE_SCOPES,
  PERMISSION_IDS,
  PLATFORM_ONLY_PERMISSIONS,
  ROLE_SCOPE_BY_NAME,
  SUPER_ADMIN,
  LEVEL_RANK,
  USER,
} from '../constants/permissions';
import { FEATURE_IDS, FEATURE_OF_PERMISSION } from '../constants/features';
import type { Actor } from '../types/actor';

type UserRow = Record<string, any>;

function buildActor(
  userRow: UserRow | null | undefined,
  permissions: Iterable<string>,
  features: readonly string[] = FEATURE_IDS
): Actor {
  if (!userRow || !userRow.id) {
    throw new Error('buildActor requires a user row');
  }
  const roleScope = ROLE_SCOPE_BY_NAME.get(userRow.role);
  if (!roleScope) {
    throw fail(
      'INTERNAL_ERROR',
      `Account "${userRow.username}" holds unknown role "${userRow.role}".`
    );
  }
  const isPlatform = roleScope === ROLE_SCOPES.platform;

  if (isPlatform && userRow.company_id !== null && userRow.company_id !== undefined) {
    throw fail('INTERNAL_ERROR', `Platform account "${userRow.username}" must not belong to a company.`);
  }
  if (!isPlatform && !userRow.company_id) {
    throw fail('INTERNAL_ERROR', `Account "${userRow.username}" has no company.`);
  }

  return {
    id: userRow.id,
    username: userRow.username,
    email: userRow.email,
    displayName: userRow.display_name || null,
    role: userRow.role,
    roleScope,
    isPlatform,
    companyId: isPlatform ? null : userRow.company_id,
    status: userRow.status,
    mustChangePassword: Boolean(userRow.must_change_password),
    permissions: Object.freeze([...permissions]),
    features: Object.freeze(isPlatform ? [...FEATURE_IDS] : [...features]),
    customRoleId: isPlatform ? null : userRow.custom_role_id ?? null,
  };
}

// The feature a denied permission belongs to, when that feature is what is missing. A role
// may well hold the permission - the company simply does not have the feature.
function missingFeature(actor: Actor, permission: string): string | null {
  if (actor.isPlatform) return null;
  const feature = FEATURE_OF_PERMISSION.get(permission);
  return feature && !actor.features.includes(feature) ? feature : null;
}

function can(actor: Actor | null | undefined, permission: string): boolean {
  if (!actor) return false;
  if (!PERMISSION_IDS.includes(permission)) {
    throw new Error(`Unknown permission "${permission}". Add it to constants/permissions.js.`);
  }
  if (actor.role === SUPER_ADMIN) return true;
  return actor.permissions.includes(permission);
}

function assertPermission(actor: Actor | null | undefined, permission: string): void {
  if (!actor) throw fail('UNAUTHENTICATED', 'Sign in to continue.');
  if (can(actor, permission)) return;

  console.warn(
    `[authz] denied "${permission}" for "${actor.username}" (role ${actor.role}, company ${actor.companyId ?? 'platform'})`
  );
  const feature = missingFeature(actor, permission);
  if (feature) {
    // No feature id in the response: a refusal never names what the account cannot use.
    throw fail('FEATURE_NOT_ENABLED', 'This is not available for your account. Ask your administrator.');
  }
  throw fail('INSUFFICIENT_PERMISSION', 'You do not have permission to perform this action.');
}

function resolveTargetCompany(actor: Actor, requestedCompanyId: unknown): number {
  if (!actor.isPlatform) return actor.companyId as number;

  const id = Number(requestedCompanyId);
  if (!Number.isInteger(id) || id <= 0) {
    throw fail('VALIDATION_ERROR', 'companyId is required: a platform account must say which company this is for.');
  }
  return id;
}

function assertCompanyMatch(actor: Actor, resourceCompanyId: unknown, what: string = 'That record'): void {
  if (actor.isPlatform) return;
  if (resourceCompanyId !== null && Number(resourceCompanyId) === Number(actor.companyId)) return;

  console.warn(
    `[authz] tenant denial: "${actor.username}" (company ${actor.companyId}) reached ` +
    `a resource in company ${resourceCompanyId ?? 'platform'}`
  );
  throw fail('TENANT_ACCESS_DENIED', `${what} does not belong to your company.`);
}

function strongestLevel(levels: readonly string[] | null | undefined): string | null {
  let best: string | null = null;
  for (const level of levels || []) {
    if (!LEVEL_RANK[level]) continue;
    if (!best || LEVEL_RANK[level] > LEVEL_RANK[best]) best = level;
  }
  return best;
}

function levelAtLeast(level: string | null | undefined, required: string): boolean {
  return Boolean(level) && (LEVEL_RANK[level!] || 0) >= (LEVEL_RANK[required] || 0);
}

function assertCanAssignRole(actor: Actor, targetRole: string) {
  const scope = ROLE_SCOPE_BY_NAME.get(targetRole);
  if (!scope) throw fail('VALIDATION_ERROR', `Unknown role: "${targetRole}"`);
  if (scope === ROLE_SCOPES.platform && !actor.isPlatform) {
    throw fail('INSUFFICIENT_PERMISSION', `Only a platform administrator can assign the ${targetRole} role.`);
  }
  return scope;
}

function assertCanManageUser(actor: Actor, target: UserRow): void {
  if (target.id === actor.id) {
    throw fail('VALIDATION_ERROR', 'Use your profile to change your own account.');
  }

  const targetScope = ROLE_SCOPE_BY_NAME.get(target.role);
  if (targetScope === ROLE_SCOPES.platform && !actor.isPlatform) {
    throw fail('TENANT_ACCESS_DENIED', 'That account is not yours to manage.');
  }

  assertCompanyMatch(actor, target.company_id, 'That account');

  if (!actor.isPlatform && target.role !== USER && target.role !== actor.role) {
    throw fail('TENANT_ACCESS_DENIED', 'That account is not yours to manage.');
  }
  if (!actor.isPlatform && target.role === actor.role) {
    throw fail(
      'TENANT_ACCESS_DENIED',
      'Another administrator of this company can only be managed by the platform owner.'
    );
  }
}

function assertRolePermissionsAllowed(roleScope: string, permissions: readonly string[]): void {
  if (roleScope === ROLE_SCOPES.platform) return;
  const escaping = permissions.filter((p) => PLATFORM_ONLY_PERMISSIONS.has(p));
  if (escaping.length) {
    throw fail(
      'VALIDATION_ERROR',
      `A company role cannot hold platform permissions: ${escaping.join(', ')}`,
      { permissions: escaping }
    );
  }
}

export {
  buildActor,
  missingFeature,
  can,
  assertPermission,
  resolveTargetCompany,
  strongestLevel,
  levelAtLeast,
  assertCanAssignRole,
  assertCanManageUser,
  assertRolePermissionsAllowed,
};
