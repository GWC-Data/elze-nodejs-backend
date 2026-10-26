import * as companyRoleRepository from './companyRoleRepository';
import * as roleRepository from './roleRepository';
import { fail } from '../../shared/errors/AppError';
import { requireUuid, requireString } from '../../shared/validation/commonValidator';
import { assertPermission, resolveTargetCompany } from '../auth/authorizationService';
import { requireCompany } from '../companies/companyService';
import { visibleFor } from '../companies/featureService';
import { defaultsFor } from './builtInRolesService';
import { parsePermissionIds, describePermission } from './roleService';
import { audit, EVENTS } from '../audit/auditService';
import { COMPANY_ADMIN, USER, ROLE_TIERS } from '../catalogue/roleTiers';
import {
  allPermissions,
  isAdminOnly,
  isKnownPermission,
  isPermissionEnabled,
  isPlatformOnly,
  maskPermissions,
  permissionIdsOf,
  permissionKeysOf,
  systemRoleId,
  systemRoles,
} from '../catalogue/catalogueService';
import { UNIQUE_VIOLATION } from '../../shared/errors/pgErrors';
import { sqlState } from '../../shared/db/dbError';
import type { Actor } from '../../shared/types/actor';
import type { Tx } from '../../shared/db/database';
import type { CompanyRoleRow } from './companyRoleRepository';

type RequestBody = Record<string, unknown>;

function reservedNames(): Set<string> {
  return new Set([
    ...ROLE_TIERS.map((tier) => tier.toLowerCase()),
    ...systemRoles().map((role) => role.name.toLowerCase().replace(/\s+/g, '_')),
    companyRoleRepository.COMPANY_DEFAULT_NAME.toLowerCase(),
  ]);
}

function keysOf(row: Pick<CompanyRoleRow, 'permissionIds'>): string[] {
  return permissionKeysOf(row.permissionIds || []);
}

function shapeRole(row: CompanyRoleRow, features: readonly string[]) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || null,
    permissionIds: permissionIdsOf(maskPermissions(keysOf(row), features)),
    userCount: Number(row.userCount || 0),
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
    modifiedAt: row.modifiedAt || null,
    modifiedBy: row.modifiedBy || null,
  };
}

async function companyFor(actor: Actor, requested: unknown): Promise<string> {
  const companyId = resolveTargetCompany(actor, requested);
  await requireCompany(actor, companyId);
  return companyId;
}

function assignable(actor: Actor, permission: string): boolean {
  if (isPlatformOnly(permission) || isAdminOnly(permission)) return false;
  return actor.isPlatform || actor.permissions.includes(permission);
}

function withImpliedReads(permissions: readonly string[]): string[] {
  const out = new Set(permissions);
  for (const key of permissions) {
    const read = `${key.split('.')[0]}.read`;
    if (read !== key && isKnownPermission(read)) out.add(read);
  }
  return [...out];
}

function parsePermissions(actor: Actor, features: readonly string[], value: unknown): string[] {
  const unique = withImpliedReads(parsePermissionIds(value));

  if (unique.some((key) => !isPermissionEnabled(key, features))) {
    throw fail('FEATURE_NOT_ENABLED', 'Some of these permissions are not available to your company.');
  }
  const refused = unique.filter((key) => !assignable(actor, key));
  if (refused.length) {
    throw fail(
      'VALIDATION_ERROR',
      `These permissions cannot be given to a company role or a member: ${refused.join(', ')}`,
      { permissionIds: permissionIdsOf(refused) }
    );
  }
  return unique.sort();
}

function parseName(value: unknown): string {
  const name = requireString(value, 'Role name', { min: 2, max: 50 });
  if (reservedNames().has(name.toLowerCase().replace(/\s+/g, '_')) || reservedNames().has(name.toLowerCase())) {
    throw fail('VALIDATION_ERROR', `"${name}" is the name of a built-in role.`);
  }
  return name;
}

function parseDescription(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requireString(value, 'Description', { max: 255 });
}

function permissionOptionsFor(actor: Actor, features: readonly string[]) {
  return allPermissions()
    .filter((p) => !p.platformOnly && isPermissionEnabled(p.key, features))
    .map((p) => ({
      ...describePermission(p.key),
      featureEnabled: isPermissionEnabled(p.key, features),
      assignable: assignable(actor, p.key) && isPermissionEnabled(p.key, features),
    }));
}

async function permissionOptions(actor: Actor, requestedCompanyId: unknown) {
  const companyId = await companyFor(actor, requestedCompanyId);
  const features = await visibleFor(companyId);
  return { companyId, features, permissions: permissionOptionsFor(actor, features) };
}

async function memberRole(companyId: string) {
  const row = await companyRoleRepository.findCompanyDefault(companyId);
  return {
    id: row ? row.id : systemRoleId(USER),
    keys: row ? keysOf(row) : await defaultsFor(USER),
    modifiedAt: row?.modifiedAt || null,
    modifiedBy: row?.modifiedBy || null,
  };
}

async function listRoles(actor: Actor, requestedCompanyId: unknown) {
  const companyId = await companyFor(actor, requestedCompanyId);
  const [features, rows, counts, adminIds, member] = await Promise.all([
    visibleFor(companyId),
    companyRoleRepository.listForCompany(companyId),
    companyRoleRepository.builtInCounts(companyId),
    roleRepository.permissionIds(systemRoleId(COMPANY_ADMIN)),
    memberRole(companyId),
  ]);

  const mayEdit = actor.isPlatform || actor.permissions.includes('role.edit');

  const builtIn = [
    {
      id: systemRoleId(COMPANY_ADMIN),
      name: COMPANY_ADMIN,
      label: 'Company admin',
      keys: permissionKeysOf(adminIds),
      modifiedAt: null,
      modifiedBy: null,
      editable: false,
    },
    {
      id: member.id,
      name: USER,
      label: 'Member',
      keys: member.keys,
      modifiedAt: member.modifiedAt,
      modifiedBy: member.modifiedBy,
      editable: mayEdit,
    },
  ].map(({ keys, ...r }) => ({
    ...r,
    permissionIds: permissionIdsOf(maskPermissions(keys, features)),
    customized: Boolean(r.modifiedAt),
    userCount: counts[r.name] || 0,
  }));

  return { companyId, features, builtIn, custom: rows.map((row) => shapeRole(row, features)) };
}

async function requireEditableBuiltIn(id: unknown, companyId: string) {
  const roleId = requireUuid(id, 'role id');
  if (roleId === systemRoleId(COMPANY_ADMIN)) {
    throw fail(
      'VALIDATION_ERROR',
      'The company admin role cannot be changed here, so a company can never lock itself out.'
    );
  }
  const current = await companyRoleRepository.findCompanyDefault(companyId);
  if (!current || current.id !== roleId) {
    throw fail('RESOURCE_NOT_FOUND', 'That is not a built-in role of this company.');
  }
  return current;
}

async function saveBuiltInRole(actor: Actor, id: unknown, body: RequestBody) {
  const companyId = await companyFor(actor, body.companyId);
  const current = await requireEditableBuiltIn(id, companyId);
  const features = await visibleFor(companyId);
  const next = parsePermissions(actor, features, body.permissionIds);

  const dormant = keysOf(current).filter((p) => !isPermissionEnabled(p, features) && !isAdminOnly(p));
  const keys = [...new Set([...next, ...dormant])].sort();

  await companyRoleRepository.saveCompanyDefault(companyId, permissionIdsOf(keys), actor.id);
  audit(EVENTS.ROLE_UPDATED, actor, {
    companyId,
    roleId: current.id,
    role: USER,
    builtIn: true,
    permissionCount: keys.length,
  });
  return listRoles(actor, companyId);
}

async function resetBuiltInRole(actor: Actor, id: unknown, requestedCompanyId: unknown) {
  const companyId = await companyFor(actor, requestedCompanyId);
  const current = await requireEditableBuiltIn(id, companyId);
  const defaults = permissionIdsOf(await defaultsFor(USER));
  if (await companyRoleRepository.resetCompanyDefault(companyId, defaults, actor.id)) {
    audit(EVENTS.ROLE_UPDATED, actor, { companyId, roleId: current.id, role: USER, builtIn: true, reset: true });
  }
  return listRoles(actor, companyId);
}

async function requireRoleInScope(actor: Actor, id: unknown, { includeDeleted = false } = {}) {
  const roleId = requireUuid(id, 'role id');
  const row = await companyRoleRepository.findInCompany(roleId, actor.isPlatform ? null : actor.companyId, {
    includeDeleted,
  });
  if (!row) throw fail('RESOURCE_NOT_FOUND', 'Role not found');
  return row;
}

async function getRole(actor: Actor, id: unknown) {
  const row = await requireRoleInScope(actor, id);
  return shapeRole(row, await visibleFor(row.companyId));
}

async function createRole(actor: Actor, body: RequestBody) {
  const companyId = await companyFor(actor, body.companyId);
  const features = await visibleFor(companyId);
  const name = parseName(body.name);
  const description = parseDescription(body.description);
  const keys = parsePermissions(actor, features, body.permissionIds ?? []);

  let id: string;
  try {
    id = await companyRoleRepository.insert({
      companyId,
      name,
      description,
      permissionIds: permissionIdsOf(keys),
      createdBy: actor.id,
    });
  } catch (err) {
    if (sqlState(err) === UNIQUE_VIOLATION) throw fail('CONFLICT', 'Your company already has a role with that name.');
    throw err;
  }

  audit(EVENTS.ROLE_CREATED, actor, { companyId, roleId: id, role: name, permissionCount: keys.length });
  return getRole(actor, id);
}

async function updateRole(actor: Actor, id: unknown, body: RequestBody) {
  const before = await requireRoleInScope(actor, id);
  const features = await visibleFor(before.companyId);

  const changes: { name?: string; description?: string | null; permissionIds?: string[] } = {};
  if (body.name !== undefined) changes.name = parseName(body.name);
  if (body.description !== undefined) changes.description = parseDescription(body.description);
  if (body.permissionIds !== undefined) {
    const next = parsePermissions(actor, features, body.permissionIds);
    const dormant = keysOf(before).filter((p) => !isPermissionEnabled(p, features));
    changes.permissionIds = permissionIdsOf([...new Set([...next, ...dormant])].sort());
  }
  if (!Object.keys(changes).length) throw fail('VALIDATION_ERROR', 'Nothing to update');

  try {
    await companyRoleRepository.update(before.id, changes, actor.id);
  } catch (err) {
    if (sqlState(err) === UNIQUE_VIOLATION) throw fail('CONFLICT', 'Your company already has a role with that name.');
    throw err;
  }

  audit(EVENTS.ROLE_UPDATED, actor, {
    companyId: before.companyId,
    roleId: before.id,
    role: changes.name || before.name,
    renamed: changes.name !== undefined && changes.name !== before.name,
    permissionCount: changes.permissionIds ? changes.permissionIds.length : undefined,
  });
  return getRole(actor, before.id);
}

async function deleteRole(
  actor: Actor,
  id: unknown,
  { permanent = false }: { permanent?: boolean } = {}
): Promise<void> {
  if (permanent) assertPermission(actor, 'delete.permanent');
  const role = await requireRoleInScope(actor, id, { includeDeleted: permanent });
  const holders = Number(role.userCount || 0);
  if (holders > 0) {
    throw fail(
      'CONFLICT',
      `${holders} member${holders === 1 ? ' still holds' : 's still hold'} this role. Give them another role first.`
    );
  }
  const done = permanent
    ? await companyRoleRepository.discard(role.id, await builtInRoleId(USER, role.companyId))
    : await companyRoleRepository.softDelete(role.id, actor.id);
  if (!done) throw fail('CONFLICT', 'A member was just given this role. Try again.');
  audit(EVENTS.ROLE_DELETED, actor, {
    companyId: role.companyId,
    roleId: role.id,
    role: role.name,
    soft: !permanent,
    permanent,
  });
}

async function restoreRole(actor: Actor, id: unknown) {
  const role = await requireRoleInScope(actor, id, { includeDeleted: true });
  try {
    if (!(await companyRoleRepository.restore(role.id))) throw fail('RESOURCE_NOT_FOUND', 'Role not found');
  } catch (err) {
    if (sqlState(err) === UNIQUE_VIOLATION) {
      throw fail('CONFLICT', `Another role in this company is now called "${role.name}". Rename that one first.`);
    }
    throw err;
  }
  audit(EVENTS.ROLE_RESTORED, actor, { companyId: role.companyId, roleId: role.id, role: role.name });
  return getRole(actor, role.id);
}

async function builtInRoleId(tier: string, companyId: string | null, conn?: Tx): Promise<string> {
  if (tier !== USER || !companyId) return systemRoleId(tier);
  const member = await companyRoleRepository.findCompanyDefault(companyId, conn);
  return member ? member.id : systemRoleId(USER);
}

async function resolveAssignableRole(actor: Actor, value: unknown, companyId: string | null): Promise<string | null> {
  if (value === null || value === undefined || value === '') return null;
  if (!companyId) throw fail('VALIDATION_ERROR', 'A platform account cannot hold a company role.');
  const roleId = requireUuid(value, 'customRoleId');
  const row = await companyRoleRepository.findInCompany(roleId, companyId);
  if (!row) throw fail('RESOURCE_NOT_FOUND', 'Role not found');
  if (!actor.isPlatform && actor.companyId !== companyId) {
    throw fail('RESOURCE_NOT_FOUND', 'Role not found');
  }
  return row.id;
}

export {
  withImpliedReads,
  assignable,
  parsePermissions,
  permissionOptionsFor,
  permissionOptions,
  listRoles,
  saveBuiltInRole,
  resetBuiltInRole,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  restoreRole,
  resolveAssignableRole,
  builtInRoleId,
};
