import * as roleRepository from './roleRepository';
import { fail, present } from '../../shared/errors/AppError';
import { requireUuid } from '../../shared/validation/commonValidator';
import { assertRolePermissionsAllowed, isPlatformOwner } from '../auth/authorizationService';
import { followDefaults } from './builtInRolesService';
import { audit, EVENTS } from '../audit/auditService';
import { COMPANY_ADMIN, PLATFORM_ADMIN, ROLE_SCOPES, SUPER_ADMIN, USER, scopeOfTier } from '../catalogue/roleTiers';
import {
  allPermissions,
  hiddenPermissionKeys,
  isHiddenPermission,
  permissionByKey,
  permissionIdsOf,
  permissionKeysOf,
  systemRoles,
  visiblePermissionIds,
  visiblePermissions,
} from '../catalogue/catalogueService';
import type { Actor } from '../../shared/types/actor';

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
  const permission = present(permissionByKey(key), `Permission ${key}`);
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

function assertRoleCompanyPairing(roleName: string, companyId: string | null | undefined) {
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
  return visiblePermissions().map((p) => describePermission(p.key));
}

async function listRoles() {
  const rows = await roleRepository.listSystemWithCounts();
  return rows.map((r) => ({
    id: r.id,
    name: r.tier,
    label: r.name,
    scope: scopeOfTier(r.tier),
    description: r.description,
    userCount: Number(r.userCount),
  }));
}

function assignableRoles(actor: Actor, requestedCompanyId: unknown) {
  const forCompany = requestedCompanyId !== undefined && requestedCompanyId !== null && requestedCompanyId !== '';
  const companyId = forCompany ? requireUuid(requestedCompanyId, 'companyId') : null;
  const tiers: string[] = forCompany ? [COMPANY_ADMIN, USER] : isPlatformOwner(actor) ? [PLATFORM_ADMIN] : [];
  return {
    companyId,
    roles: systemRoles()
      .filter((role) => tiers.includes(role.tier))
      .sort((a, b) => tiers.indexOf(a.tier) - tiers.indexOf(b.tier))
      .map((role) => ({
        id: role.id,
        role: role.tier,
        label: role.name,
        description: role.description,
        scope: scopeOfTier(role.tier),
      })),
  };
}

async function requireSystemRole(id: unknown) {
  const role = await roleRepository.findSystemRole(requireUuid(id, 'role id'));
  if (!role) throw fail('RESOURCE_NOT_FOUND', 'Role not found');
  return role;
}

function shapeRolePermissions(role: { id: string; tier: string; name: string }, permissionIds: readonly string[]) {
  return {
    id: role.id,
    role: role.tier,
    label: role.name,
    scope: scopeOfTier(role.tier),
    editable: role.tier !== SUPER_ADMIN,
    permissionIds: visiblePermissionIds(permissionIds),
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

  const submitted = parsePermissionIds(permissionIds).filter((key) => !isHiddenPermission(key));
  const keys = [...submitted, ...hiddenPermissionKeys(permissionKeysOf(role.permissionIds))];
  assertRolePermissionsAllowed(present(scopeOfTier(role.tier), `The scope of ${role.tier}`), keys);

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
  assignableRoles,
  describeRolePermissions,
  replaceRolePermissions,
};
