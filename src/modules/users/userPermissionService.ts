import * as userPermissionRepository from './userPermissionRepository';
import * as roleRepository from '../roles/roleRepository';
import { fail } from '../../shared/errors/AppError';
import { requireUserInScope, requireManageable } from './userService';
import { visibleFor } from '../companies/featureService';
import { parsePermissions, permissionOptionsFor } from '../roles/companyRoleService';
import { audit, EVENTS } from '../audit/auditService';
import { USER } from '../catalogue/roleTiers';
import { isPermissionEnabled, maskPermissions, permissionIdsOf, permissionKeysOf } from '../catalogue/catalogueService';
import type { Actor } from '../../shared/types/actor';
import type { UserInScopeRow } from './userRepository';

type Row = UserInScopeRow;

function mayEdit(actor: Actor, target: Row): boolean {
  if (!target.company_id || target.role !== USER || target.id === actor.id) return false;
  return actor.isPlatform || actor.permissions.includes('user.update');
}

async function describe(actor: Actor, target: Row) {
  const features = target.company_id ? await visibleFor(target.company_id) : [];
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
    throw fail(
      'VALIDATION_ERROR',
      'Extra permissions are only for members. A company admin already holds every company permission.'
    );
  }

  const features = await visibleFor(target.company_id);
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
