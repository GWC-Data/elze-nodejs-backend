import * as companyRoleRepository from '../repositories/companyRoleRepository';
import * as roleRepository from '../repositories/roleRepository';
import { fail } from '../tools/AppError';
import { requireId, requireString } from '../validators/commonValidator';
import { resolveTargetCompany } from './authorizationService';
import { requireCompany } from './companyService';
import { enabledFor } from './featureService';
import { defaultsFor } from './builtInRolesService';
import { audit, EVENTS } from './auditService';
import {
  ALL_PERMISSIONS,
  ALL_PERMISSION_IDS,
  PLATFORM_ONLY_PERMISSIONS,
  CUSTOM_ROLE_EXCLUDED,
  COMPANY_ADMIN,
  USER,
  ROLE_NAMES,
} from '../constants/permissions';
import { FEATURE_OF_PERMISSION, isPermissionEnabled, maskPermissions } from '../constants/features';
import { UNIQUE_VIOLATION, FOREIGN_KEY_VIOLATION } from '../constants/pgErrors';
import type { Actor } from '../types/actor';

type Row = Record<string, any>;

function shapeRole(row: Row, features: readonly string[]) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || null,
    permissions: maskPermissions(row.permissions || [], features),
    userCount: Number(row.userCount || 0),
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
    modifiedAt: row.modifiedAt || null,
    modifiedBy: row.modifiedBy || null,
  };
}

async function companyFor(actor: Actor, requested: unknown): Promise<number> {
  const companyId = resolveTargetCompany(actor, requested);
  await requireCompany(actor, companyId);
  return companyId;
}

function assignable(actor: Actor, permission: string): boolean {
  if (PLATFORM_ONLY_PERMISSIONS.has(permission) || CUSTOM_ROLE_EXCLUDED.has(permission)) return false;
  return actor.isPlatform || actor.permissions.includes(permission);
}

function withImpliedReads(permissions: readonly string[]): string[] {
  const out = new Set(permissions);
  for (const id of permissions) {
    const read = `${id.split('.')[0]}.read`;
    if (read !== id && ALL_PERMISSION_IDS.has(read)) out.add(read);
  }
  return [...out];
}

function parsePermissions(actor: Actor, features: readonly string[], value: unknown): string[] {
  if (!Array.isArray(value)) throw fail('VALIDATION_ERROR', 'permissions must be an array of permission ids.');
  const unique = withImpliedReads([...new Set(value.map(String))]);

  const unknown = unique.filter((id) => !ALL_PERMISSION_IDS.has(id));
  if (unknown.length) {
    throw fail('VALIDATION_ERROR', `Unknown permission id(s): ${unknown.join(', ')}`, { permissions: unknown });
  }
  if (unique.some((id) => !isPermissionEnabled(id, features))) {
    throw fail('FEATURE_NOT_ENABLED', 'Some of these permissions are not available to your company.');
  }
  const refused = unique.filter((id) => !assignable(actor, id));
  if (refused.length) {
    throw fail(
      'VALIDATION_ERROR',
      `These permissions cannot be given to a company role: ${refused.join(', ')}`,
      { permissions: refused }
    );
  }
  return unique.sort();
}

function parseName(value: unknown): string {
  const name = requireString(value, 'Role name', { min: 2, max: 50 });
  if (ROLE_NAMES.some((builtIn) => builtIn.toLowerCase() === name.toLowerCase().replace(/\s+/g, '_'))) {
    throw fail('VALIDATION_ERROR', `"${name}" is the name of a built-in role.`);
  }
  return name;
}

function parseDescription(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requireString(value, 'Description', { max: 255 });
}

async function permissionOptions(actor: Actor, requestedCompanyId: unknown) {
  const companyId = await companyFor(actor, requestedCompanyId);
  const features = await enabledFor(companyId);
  return {
    companyId,
    features,
    permissions: ALL_PERMISSIONS.filter(
      (p) => !PLATFORM_ONLY_PERMISSIONS.has(p.id) && isPermissionEnabled(p.id, features)
    ).map((p) => {
      const feature = FEATURE_OF_PERMISSION.get(p.id) || null;
      return {
        ...p,
        feature,
        featureEnabled: isPermissionEnabled(p.id, features),
        assignable: assignable(actor, p.id) && isPermissionEnabled(p.id, features),
        adminOnly: CUSTOM_ROLE_EXCLUDED.has(p.id),
      };
    }),
  };
}

const EDITABLE_BUILT_IN = new Set([USER]);

async function listRoles(actor: Actor, requestedCompanyId: unknown) {
  const companyId = await companyFor(actor, requestedCompanyId);
  const [features, rows, counts, adminPermissions, memberCopy] = await Promise.all([
    enabledFor(companyId),
    companyRoleRepository.listForCompany(companyId),
    companyRoleRepository.builtInCounts(companyId),
    roleRepository.permissionIds(COMPANY_ADMIN, { ordered: true }),
    companyRoleRepository.findBuiltInOverride(companyId, USER),
  ]);
  const memberPermissions: string[] = memberCopy ? memberCopy.permissions : await defaultsFor(USER);

  const mayEdit = actor.isPlatform || actor.permissions.includes('role.edit');

  const builtIn = [
    { name: COMPANY_ADMIN, label: 'Company admin', permissions: adminPermissions, modifiedAt: null, modifiedBy: null },
    {
      name: USER,
      label: 'Member',
      permissions: memberPermissions,
      modifiedAt: memberCopy?.modifiedAt || null,
      modifiedBy: memberCopy?.modifiedBy || null,
    },
  ].map((r) => ({
    ...r,
    permissions: maskPermissions(r.permissions, features),
    customized: Boolean(r.modifiedAt),
    userCount: counts[r.name] || 0,
    editable: mayEdit && EDITABLE_BUILT_IN.has(r.name),
  }));

  return { companyId, features, builtIn, custom: rows.map((row: Row) => shapeRole(row, features)) };
}

function requireEditableBuiltIn(name: unknown): string {
  const roleName = String(name || '');
  if (!EDITABLE_BUILT_IN.has(roleName)) {
    throw fail(
      'VALIDATION_ERROR',
      roleName === COMPANY_ADMIN
        ? 'The company admin role cannot be changed here, so a company can never lock itself out.'
        : `"${roleName}" is not a built-in role a company can change.`
    );
  }
  return roleName;
}

async function saveBuiltInRole(actor: Actor, name: unknown, body: Row) {
  const roleName = requireEditableBuiltIn(name);
  const companyId = await companyFor(actor, body.companyId);
  const features = await enabledFor(companyId);
  const next = parsePermissions(actor, features, body.permissions);

  const current = await companyRoleRepository.findBuiltInOverride(companyId, roleName);
  const base: string[] = current ? current.permissions : await defaultsFor(roleName);
  const dormant = base.filter((p) => !isPermissionEnabled(p, features) && !CUSTOM_ROLE_EXCLUDED.has(p));
  const permissions = [...new Set([...next, ...dormant])].sort();

  await companyRoleRepository.saveBuiltInCopy(companyId, roleName, permissions, actor.id);
  audit(EVENTS.ROLE_UPDATED, actor, { companyId, role: roleName, builtIn: true, permissionCount: permissions.length });
  return listRoles(actor, companyId);
}

async function resetBuiltInRole(actor: Actor, name: unknown, requestedCompanyId: unknown) {
  const roleName = requireEditableBuiltIn(name);
  const companyId = await companyFor(actor, requestedCompanyId);
  if (await companyRoleRepository.resetBuiltInCopy(companyId, roleName, await defaultsFor(roleName))) {
    audit(EVENTS.ROLE_UPDATED, actor, { companyId, role: roleName, builtIn: true, reset: true });
  }
  return listRoles(actor, companyId);
}

async function requireRoleInScope(actor: Actor, id: unknown) {
  const roleId = requireId(id, 'role id');
  const row = await companyRoleRepository.findInCompany(roleId, actor.isPlatform ? null : actor.companyId);
  if (!row) throw fail('RESOURCE_NOT_FOUND', 'Role not found');
  return row;
}

async function getRole(actor: Actor, id: unknown) {
  const row = await requireRoleInScope(actor, id);
  return shapeRole(row, await enabledFor(row.companyId));
}

async function createRole(actor: Actor, body: Row) {
  const companyId = await companyFor(actor, body.companyId);
  const features = await enabledFor(companyId);
  const name = parseName(body.name);
  const description = parseDescription(body.description);
  const permissions = parsePermissions(actor, features, body.permissions ?? []);

  let id: number;
  try {
    id = await companyRoleRepository.insert({ companyId, name, description, permissions, createdBy: actor.id });
  } catch (err: any) {
    if (err.code === UNIQUE_VIOLATION) throw fail('CONFLICT', 'Your company already has a role with that name.');
    throw err;
  }

  audit(EVENTS.ROLE_CREATED, actor, { companyId, roleId: id, role: name, permissionCount: permissions.length });
  return getRole(actor, id);
}

async function updateRole(actor: Actor, id: unknown, body: Row) {
  const before = await requireRoleInScope(actor, id);
  const features = await enabledFor(before.companyId);

  const changes: { name?: string; description?: string | null; permissions?: string[] } = {};
  if (body.name !== undefined) changes.name = parseName(body.name);
  if (body.description !== undefined) changes.description = parseDescription(body.description);
  if (body.permissions !== undefined) {
    const next = parsePermissions(actor, features, body.permissions);
    const dormant = (before.permissions as string[]).filter((p) => !isPermissionEnabled(p, features));
    changes.permissions = [...new Set([...next, ...dormant])].sort();
  }
  if (!Object.keys(changes).length) throw fail('VALIDATION_ERROR', 'Nothing to update');

  try {
    await companyRoleRepository.update(before.id, changes, actor.id);
  } catch (err: any) {
    if (err.code === UNIQUE_VIOLATION) throw fail('CONFLICT', 'Your company already has a role with that name.');
    throw err;
  }

  audit(EVENTS.ROLE_UPDATED, actor, {
    companyId: before.companyId,
    roleId: before.id,
    role: changes.name || before.name,
    renamed: changes.name !== undefined && changes.name !== before.name,
    permissionCount: changes.permissions ? changes.permissions.length : undefined,
  });
  return getRole(actor, before.id);
}

async function deleteRole(actor: Actor, id: unknown): Promise<void> {
  const role = await requireRoleInScope(actor, id);
  const holders = Number(role.userCount || 0);
  if (holders > 0) {
    throw fail(
      'CONFLICT',
      `${holders} member${holders === 1 ? ' still holds' : 's still hold'} this role. Give them another role first.`
    );
  }
  try {
    await companyRoleRepository.remove(role.id);
  } catch (err: any) {
    if (err.code === FOREIGN_KEY_VIOLATION) throw fail('CONFLICT', 'A member was just given this role. Try again.');
    throw err;
  }
  audit(EVENTS.ROLE_DELETED, actor, { companyId: role.companyId, roleId: role.id, role: role.name });
}

async function resolveAssignableRole(actor: Actor, value: unknown, companyId: number | null): Promise<number | null> {
  if (value === null || value === undefined || value === '') return null;
  if (!companyId) throw fail('VALIDATION_ERROR', 'A platform account cannot hold a company role.');
  const roleId = requireId(value, 'customRoleId');
  const row = await companyRoleRepository.findInCompany(roleId, companyId);
  if (!row) throw fail('RESOURCE_NOT_FOUND', 'Role not found');
  if (!actor.isPlatform && Number(actor.companyId) !== Number(companyId)) {
    throw fail('RESOURCE_NOT_FOUND', 'Role not found');
  }
  return row.id;
}

export {
  withImpliedReads,
  permissionOptions,
  listRoles,
  saveBuiltInRole,
  resetBuiltInRole,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  resolveAssignableRole,
};
