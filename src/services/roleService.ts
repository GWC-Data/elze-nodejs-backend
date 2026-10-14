import * as roleRepository from '../repositories/roleRepository';
import { fail } from '../tools/AppError';
import { requireUuid } from '../validators/commonValidator';
import { assertRolePermissionsAllowed } from './authorizationService';
import { followDefaults } from './builtInRolesService';
import { audit, EVENTS } from './auditService';
import {
  ALL_PERMISSIONS,
  PERMISSION_BY_ID,
  PLATFORM_ONLY_PERMISSIONS,
  CUSTOM_ROLE_EXCLUDED,
  ROLE_SCOPES,
  ROLE_SCOPE_BY_NAME,
  SUPER_ADMIN,
  permissionIdsOf,
  permissionKeysOf,
} from '../constants/permissions';
import { FEATURE_OF_PERMISSION, FEATURE_BY_KEY } from '../constants/features';
import type { Actor } from '../types/actor';

function parsePermissionIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw fail('VALIDATION_ERROR', 'permissionIds must be an array of permission ids.');
  }
  const ids = [...new Set(value.map((v) => String(v).trim().toLowerCase()))];
  const unknown = ids.filter((id) => !PERMISSION_BY_ID.has(id));
  if (unknown.length) {
    throw fail('VALIDATION_ERROR', `Unknown permission id(s): ${unknown.join(', ')}`, { permissionIds: unknown });
  }
  return permissionKeysOf(ids);
}

function describePermission(key: string) {
  const permission = ALL_PERMISSIONS.find((p) => p.key === key)!;
  const feature = FEATURE_OF_PERMISSION.get(key) || null;
  return {
    ...permission,
    platformOnly: PLATFORM_ONLY_PERMISSIONS.has(key),
    adminOnly: CUSTOM_ROLE_EXCLUDED.has(key),
    feature,
    featureId: feature ? FEATURE_BY_KEY.get(feature)!.id : null,
  };
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
  return ALL_PERMISSIONS.map((p) => describePermission(p.key));
}

async function listRoles() {
  const rows = await roleRepository.listSystemWithCounts();
  return rows.map((r: Record<string, any>) => ({
    id: r.id,
    name: r.tier,
    label: r.name,
    scope: ROLE_SCOPE_BY_NAME.get(r.tier),
    description: r.description,
    userCount: Number(r.userCount),
  }));
}

async function requireSystemRole(id: unknown) {
  const role = await roleRepository.findSystemRole(requireUuid(id, 'role id'));
  if (!role) throw fail('RESOURCE_NOT_FOUND', 'Role not found');
  return role;
}

function shapeRolePermissions(role: Record<string, any>, permissionIds: readonly string[]) {
  return {
    id: role.id,
    role: role.tier,
    label: role.name,
    scope: ROLE_SCOPE_BY_NAME.get(role.tier),
    editable: role.tier !== SUPER_ADMIN,
    permissionIds: [...permissionIds],
  };
}

async function describeRolePermissions(id: unknown) {
  const role = await requireSystemRole(id);
  if (role.tier === SUPER_ADMIN) return shapeRolePermissions(role, ALL_PERMISSIONS.map((p) => p.id));
  return shapeRolePermissions(role, role.permissionIds);
}

async function replaceRolePermissions(actor: Actor, id: unknown, permissionIds: unknown) {
  const role = await requireSystemRole(id);

  if (role.tier === SUPER_ADMIN) {
    throw fail(
      'VALIDATION_ERROR',
      'SUPER_ADMIN always holds every permission and cannot be edited - that is what keeps the platform recoverable from a bad permission change.'
    );
  }

  const keys = parsePermissionIds(permissionIds);
  assertRolePermissionsAllowed(ROLE_SCOPE_BY_NAME.get(role.tier)!, keys);

  const ids = permissionIdsOf(keys);
  await roleRepository.replacePermissions(role.id, ids, actor.id);
  const following = await followDefaults(role.tier);

  audit(EVENTS.ROLE_PERMISSIONS_UPDATED, actor, {
    roleId: role.id,
    role: role.tier,
    permissionCount: ids.length,
    companiesFollowing: following || undefined,
  });
  return shapeRolePermissions(role, ids);
}

export {
  parsePermissionIds,
  describePermission,
  assertRoleCompanyPairing,
  permissionCatalogue,
  listRoles,
  describeRolePermissions,
  replaceRolePermissions,
};
