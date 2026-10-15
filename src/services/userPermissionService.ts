import * as userPermissionRepository from '../repositories/userPermissionRepository';
import * as roleRepository from '../repositories/roleRepository';
import { fail } from '../tools/AppError';
import { requireUserInScope, requireManageable } from './userService';
import { enabledFor } from './featureService';
import { parsePermissions, permissionOptionsFor } from './companyRoleService';
import { audit, EVENTS } from './auditService';
import { USER } from '../constants/roles';
import { isPermissionEnabled, maskPermissions, permissionIdsOf, permissionKeysOf } from './catalogueService';
import type { Actor } from '../types/actor';

type Row = Record<string, any>;

function mayEdit(actor: Actor, target: Row): boolean {
  if (!target.company_id || target.role !== USER || target.id === actor.id) return false;
  return actor.isPlatform || actor.permissions.includes('user.update');
}

async function describe(actor: Actor, target: Row) {
  const features = target.company_id ? await enabledFor(target.company_id) : [];
  const [roleIds, extraIds] = await Promise.all([
    target.role_id ? roleRepository.permissionIds(target.role_id) : Promise.resolve([]),
    userPermissionRepository.permissionIds(target.id),
  ]);
  return {
    userId: target.id,
    role: { id: target.role_id, name: target.role_name, tier: target.role, kind: target.role_kind },
    rolePermissionIds: permissionIdsOf(maskPermissions(permissionKeysOf(roleIds), features)),
    extraPermissionIds: permissionIdsOf(maskPermissions(permissionKeysOf(extraIds), features)),
    editable: mayEdit(actor, target),
    options: target.company_id && target.role === USER ? permissionOptionsFor(actor, features) : [],
  };
}

async function describeUserPermissions(actor: Actor, id: number) {
  return describe(actor, await requireUserInScope(actor, id));
}

async function replaceUserPermissions(actor: Actor, id: number, permissionIds: unknown) {
  const target = await requireManageable(actor, id);
  if (!target.company_id) {
    throw fail('VALIDATION_ERROR', 'A platform account already holds every permission.');
  }
  if (target.role !== USER) {
    throw fail('VALIDATION_ERROR', 'Extra permissions are only for members. A company admin already holds every company permission.');
  }

  const features = await enabledFor(target.company_id);
  const next = parsePermissions(actor, features, permissionIds ?? []);
  const before = permissionKeysOf(await userPermissionRepository.permissionIds(target.id));
  const dormant = before.filter((key) => !isPermissionEnabled(key, features));
  const keys = [...new Set([...next, ...dormant])].sort();

  await userPermissionRepository.replace(target.id, permissionIdsOf(keys), actor.id);

  const added = keys.filter((key) => !before.includes(key));
  const removed = before.filter((key) => !keys.includes(key));
  if (added.length || removed.length) {
    audit(EVENTS.USER_PERMISSIONS_UPDATED, actor, {
      userId: target.id,
      targetUsername: target.username,
      companyId: target.company_id,
      added,
      removed,
      permissionCount: keys.length,
    });
  }
  return describe(actor, target);
}

export { describeUserPermissions, replaceUserPermissions };
