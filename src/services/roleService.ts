import * as roleRepository from '../repositories/roleRepository';
import { fail } from '../tools/AppError';
import { assertRolePermissionsAllowed } from './authorizationService';
import { followDefaults } from './builtInRolesService';
import { audit, EVENTS } from './auditService';
import {
  ALL_PERMISSIONS,
  ALL_PERMISSION_IDS,
  PERMISSION_IDS,
  PLATFORM_ONLY_PERMISSIONS,
  ROLE_SCOPES,
  ROLE_SCOPE_BY_NAME,
  SUPER_ADMIN,
} from '../constants/permissions';
import { FEATURE_OF_PERMISSION } from '../constants/features';
import type { Actor } from '../types/actor';

function rolePermissionList(roleName: string, storedIds: readonly string[] | null | undefined): string[] {
  if (roleName === SUPER_ADMIN) return [...PERMISSION_IDS];
  return (storedIds || []).filter((id) => PERMISSION_IDS.includes(id));
}

async function getRolePermissions(roleName: string | null | undefined): Promise<string[]> {
  if (!roleName) return [];
  if (roleName === SUPER_ADMIN) return [...PERMISSION_IDS];
  return rolePermissionList(roleName, await roleRepository.permissionIds(roleName));
}

async function findRole(name: unknown) {
  if (typeof name !== 'string' || !name.trim()) return null;
  return roleRepository.findByName(name.trim());
}

async function requireRole(name: unknown) {
  const role = await findRole(name);
  if (!role) throw fail('RESOURCE_NOT_FOUND', 'Role not found');
  return role;
}

function assertRoleCompanyPairing(roleName: string, companyId: number | null | undefined) {
  const scope = ROLE_SCOPE_BY_NAME.get(roleName);
  if (!scope) throw fail('VALIDATION_ERROR', `Unknown role: "${roleName}"`);

  if (scope === ROLE_SCOPES.platform && companyId) {
    throw fail('VALIDATION_ERROR', `${roleName} is a platform role and cannot belong to a company.`);
  }
  if (scope === ROLE_SCOPES.company && !companyId) {
    throw fail('VALIDATION_ERROR', `${roleName} must belong to a company.`);
  }
  return scope;
}

function permissionCatalogue() {
  return ALL_PERMISSIONS.map((p) => ({
    ...p,
    platformOnly: PLATFORM_ONLY_PERMISSIONS.has(p.id),
    feature: FEATURE_OF_PERMISSION.get(p.id) || null,
  }));
}

async function listRoles() {
  const rows = await roleRepository.listWithCounts();
  return rows.map((r: Record<string, any>) => ({ ...r, userCount: Number(r.userCount) }));
}

async function describeRolePermissions(name: unknown) {
  const role = await requireRole(name);
  if (role.name === SUPER_ADMIN) {
    return { role: role.name, scope: role.scope, editable: false, permissions: [...ALL_PERMISSION_IDS] };
  }
  return {
    role: role.name,
    scope: role.scope,
    editable: true,
    permissions: await roleRepository.permissionIds(role.name, { ordered: true }),
  };
}

async function replaceRolePermissions(actor: Actor, name: unknown, permissions: unknown) {
  const role = await requireRole(name);

  if (role.name === SUPER_ADMIN) {
    throw fail(
      'VALIDATION_ERROR',
      'SUPER_ADMIN always holds every permission and cannot be edited - that is what keeps the platform recoverable from a bad permission change.'
    );
  }

  if (!Array.isArray(permissions)) {
    throw fail('VALIDATION_ERROR', 'permissions must be an array of permission ids');
  }

  const unique = [...new Set(permissions.map(String))];
  const unknown = unique.filter((id) => !ALL_PERMISSION_IDS.has(id));
  if (unknown.length) {
    throw fail('VALIDATION_ERROR', `Unknown permission id(s): ${unknown.join(', ')}`, { permissions: unknown });
  }

  assertRolePermissionsAllowed(role.scope, unique);

  await roleRepository.replacePermissions(role.name, unique);
  const following = await followDefaults(role.name);

  audit(EVENTS.ROLE_PERMISSIONS_UPDATED, actor, {
    role: role.name,
    permissionCount: unique.length,
    companiesFollowing: following || undefined,
  });
  return {
    role: role.name,
    scope: role.scope,
    editable: role.scope !== ROLE_SCOPES.platform || role.name !== SUPER_ADMIN,
    permissions: unique,
  };
}

export {
  rolePermissionList,
  getRolePermissions,
  assertRoleCompanyPairing,
  permissionCatalogue,
  listRoles,
  describeRolePermissions,
  replaceRolePermissions,
};
