// A company's own roles, managed by its administrator - the Domo model: every member holds
// one role, a role is a set of permissions, and everyone holding it gets exactly those.
//
// The three built-in roles still decide the shell and who may manage whom. A custom role is
// a MEMBER role: a member keeps users.role = USER and points custom_role_id at one of these,
// whose permissions then replace USER's (user.repository findActorRow).
//
// Rules, all enforced here, not in the UI:
//   - a role only exists inside one company; another company's role answers 404;
//   - it can hold feature permissions only for features the company has;
//   - it can never hold platform permissions, nor the ones that manage people, groups or
//     roles (CUSTOM_ROLE_EXCLUDED);
//   - nobody grants what they do not hold themselves (no escalation);
//   - Create/Edit/Delete/Run imply View of the same thing, so a role cannot be unusable.
//
// Every company has its own copy of the built-in Member (USER) role (builtInRoles.service):
// it follows the platform owner's defaults until the company admin edits it, then it is that
// company's alone. COMPANY_ADMIN is not editable here - an admin able to trim their own role
// could remove role.edit from it and leave the company with nobody able to put it back.
//
// Responses never carry a permission of a feature the company does not have: role lists,
// single roles and the permission grid are all masked to the company's enabled features.

import * as companyRoleRepository from '../repositories/companyRole.repository';
import * as roleRepository from '../repositories/role.repository';
import { fail } from '../tools/AppError';
import { requireId, requireString } from '../validators/common.validator';
import { resolveTargetCompany } from './authorization.service';
import { requireCompany } from './company.service';
import { enabledFor } from './feature.service';
import { defaultsFor } from './builtInRoles.service';
import { audit, EVENTS } from './audit.service';
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

// `features`: the company's enabled features - permissions of any other feature are kept in the
// database (they come back when the feature does) but never sent.
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

// `x.create` → `x.read` when that exists; analyst.use has no read and needs none.
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
  // Refused without naming the features: a response never lists what the company lacks.
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

// The permission grid the Roles screen draws: every permission, grouped by feature, with
// whether this company has the feature and whether THIS caller may hand it out.
async function permissionOptions(actor: Actor, requestedCompanyId: unknown) {
  const companyId = await companyFor(actor, requestedCompanyId);
  const features = await enabledFor(companyId);
  return {
    companyId,
    features,
    // Only what the company can use: platform permissions and those of features it does not
    // have are left out of the response altogether, not just greyed out.
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

// Only these built-in roles can be tailored by a company.
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
  // Every company has its copy; the shared defaults only stand in if one is somehow missing.
  const memberPermissions: string[] = memberCopy ? memberCopy.permissions : await defaultsFor(USER);

  const mayEdit = actor.isPlatform || actor.permissions.includes('role.edit');

  // Built-in roles as this company has them, masked by its features.
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

// The company's own version of a built-in role. Sent as the whole set, like a custom role.
async function saveBuiltInRole(actor: Actor, name: unknown, body: Row) {
  const roleName = requireEditableBuiltIn(name);
  const companyId = await companyFor(actor, body.companyId);
  const features = await enabledFor(companyId);
  const next = parsePermissions(actor, features, body.permissions);

  // Permissions of features switched off since are kept, as for custom roles.
  const current = await companyRoleRepository.findBuiltInOverride(companyId, roleName);
  const base: string[] = current ? current.permissions : await defaultsFor(roleName);
  const dormant = base.filter((p) => !isPermissionEnabled(p, features) && !CUSTOM_ROLE_EXCLUDED.has(p));
  const permissions = [...new Set([...next, ...dormant])].sort();

  // From now on the company's own version: the platform owner's default changes skip it.
  await companyRoleRepository.saveBuiltInCopy(companyId, roleName, permissions, actor.id);
  audit(EVENTS.ROLE_UPDATED, actor, { companyId, role: roleName, builtIn: true, permissionCount: permissions.length });
  return listRoles(actor, companyId);
}

// Back to the platform owner's defaults.
async function resetBuiltInRole(actor: Actor, name: unknown, requestedCompanyId: unknown) {
  const roleName = requireEditableBuiltIn(name);
  const companyId = await companyFor(actor, requestedCompanyId);
  // The copy takes the current platform defaults and follows them again.
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
    // A permission of a feature switched off since is kept, not wiped: the role is masked
    // today and complete again the day the feature returns.
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
    // Someone was given the role between the count and the delete.
    if (err.code === FOREIGN_KEY_VIOLATION) throw fail('CONFLICT', 'A member was just given this role. Try again.');
    throw err;
  }
  audit(EVENTS.ROLE_DELETED, actor, { companyId: role.companyId, roleId: role.id, role: role.name });
}

// For user.service: the custom role an account may be given, or null to clear it.
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
