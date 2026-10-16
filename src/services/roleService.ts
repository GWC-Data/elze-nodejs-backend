import * as roleRepository from '../repositories/roleRepository';
import { fail } from '../tools/AppError';
import { requireUuid } from '../validators/commonValidator';
import { assertRolePermissionsAllowed } from './authorizationService';
import { followDefaults } from './builtInRolesService';
import { audit, EVENTS } from './auditService';
import { ROLE_SCOPES, SUPER_ADMIN, scopeOfTier } from '../constants/roles';
import { allPermissions, permissionByKey, permissionIdsOf, permissionKeysOf } from './catalogueService';
import type { Actor } from '../types/actor';

function parsePermissionIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw fail('VALIDATION_ERROR', 'permissionIds must be an array of permission ids.');
  }
  const ids = [...new Set(value.map((v) => String(v).trim().toLowerCase()))];
  const known = new Set(allPermissions().map((p) => p.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) {
    throw fail('VALIDATION_ERROR', `Unknown permission id(s): ${unknown.join(', ')}`, { permissionIds: unknown });
  }
  return permissionKeysOf(ids);
}

function describePermission(key: string) {
  const permission = permissionByKey(key)!;
  return {
    id: permission.id,
    key: permission.key,
    label: permission.label,
    description: permission.description,
    platformOnly: permission.platformOnly,
    adminOnly: permission.adminOnly,
    feature: permission.featureKey,
    featureId: permission.featureId,
  };
}

function assertRoleCompanyPairing(roleName: string, companyId: number | null | undefined) {
  const scope = scopeOfTier(roleName);
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
  return allPermissions().map((p) => describePermission(p.key));
}

async function listRoles() {
  const rows = await roleRepository.listSystemWithCounts();
  return rows.map((r: Record<string, any>) => ({
    id: r.id,
    name: r.tier,
    label: r.name,
    scope: scopeOfTier(r.tier),
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
    scope: scopeOfTier(role.tier),
    editable: role.tier !== SUPER_ADMIN,
    permissionIds: [...permissionIds],
  };
}

async function describeRolePermissions(id: unknown) {
  const role = await requireSystemRole(id);
  if (role.tier === SUPER_ADMIN)
    return shapeRolePermissions(
      role,
      allPermissions().map((p) => p.id)
    );
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
  assertRolePermissionsAllowed(scopeOfTier(role.tier)!, keys);

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
