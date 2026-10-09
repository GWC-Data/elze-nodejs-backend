import config from '../config';
import * as userRepository from '../repositories/userRepository';
import { fail } from '../tools/AppError';
import { likePattern } from '../tools/listQuery';
import { publicUser, userListItem } from '../views/serializers/userSerializer';
import { resolveTargetCompany, assertCanAssignRole, assertCanManageUser } from './authorizationService';
import { rolePermissionList, assertRoleCompanyPairing } from './roleService';
import { requireActiveCompany } from './companyService';
import { resolveAssignableRole } from './companyRoleService';
import { createAndInvite, prepareInvitation } from './onboardingService';
import { sendEmail } from './emailService';
import { revokeAllForUser } from './tokenService';
import { audit, EVENTS } from './auditService';
import { ROLE_SCOPE_BY_NAME, USER } from '../constants/permissions';
import { FEATURE_IDS, effectiveFeatures, maskPermissions } from '../constants/features';
import { USER_STATUS, USER_STATUSES } from '../constants/statuses';
import type { Actor } from '../types/actor';
import type { Queryable } from '../config/pgPool';
import type { ListWindow } from '../repositories/baseRepository';

const { withTransaction } = config.database;

async function findActor(id: number) {
  const row = await userRepository.findActorRow(id);
  if (!row) return null;
  const scopes: Record<string, unknown[]> = {};
  for (const [dimension, value] of row.scopes) (scopes[dimension] = scopes[dimension] || []).push(value);
  const features = row.company_id ? effectiveFeatures(row.features) : [...FEATURE_IDS];
  const permissions = rolePermissionList(row.role, row.permissions);
  return {
    user: row,
    permissions: row.company_id ? maskPermissions(permissions, features) : permissions,
    features,
    scopes,
  };
}

async function requireUserInScope(actor: Actor, id: number) {
  const user = await userRepository.findInScope(actor, id);
  if (!user) throw fail('RESOURCE_NOT_FOUND', 'User not found');
  return user;
}

async function requireManageable(actor: Actor, id: number) {
  const target = await requireUserInScope(actor, id);
  assertCanManageUser(actor, target);
  return target;
}

async function listUsers(
  actor: Actor,
  list: ListWindow,
  { companyId, role, status }: { companyId?: unknown; role?: unknown; status?: unknown } = {}
) {
  const where: string[] = [];
  const params: unknown[] = [];

  if (actor.isPlatform) {
    if (companyId !== undefined && companyId !== null && companyId !== '') {
      const id = Number(companyId);
      if (!Number.isInteger(id) || id < 1) throw fail('VALIDATION_ERROR', 'companyId must be a positive integer.');
      where.push('u.company_id = ?');
      params.push(id);
    }
  } else {
    where.push('u.company_id = ?');
    params.push(actor.companyId);
  }
  if (role) {
    if (!ROLE_SCOPE_BY_NAME.has(String(role))) throw fail('VALIDATION_ERROR', `Unknown role: "${role}"`);
    where.push('u.role = ?');
    params.push(String(role));
  }
  if (status) {
    if (!USER_STATUSES.includes(String(status))) {
      throw fail('VALIDATION_ERROR', `status must be one of: ${USER_STATUSES.join(', ')}.`);
    }
    where.push('u.status = ?');
    params.push(String(status));
  }
  if (list.search) {
    where.push(`(u.username ILIKE ? OR u.email ILIKE ? OR u.display_name ILIKE ?)`);
    const pattern = likePattern(list.search);
    params.push(pattern, pattern, pattern);
  }

  return userRepository.listPage(where, params, list, (row: Record<string, any>) => userListItem(row, actor.isPlatform));
}

async function currentUser(id: number) {
  return publicUser(await userRepository.findById(id));
}

async function createUser(
  actor: Actor,
  { username, email, displayName, role, customRoleId: requestedCustomRole, companyId: requestedCompanyId }: Record<string, any>
) {
  const targetRole = String(role || '').trim();
  if (!targetRole) throw fail('VALIDATION_ERROR', 'A role is required.');

  const scope = assertCanAssignRole(actor, targetRole);

  const companyId = scope === 'platform' ? null : resolveTargetCompany(actor, requestedCompanyId);

  if (companyId !== null) {
    await requireActiveCompany(actor, companyId, 'That company is deactivated, so accounts cannot be added to it.');
  }

  const customRoleId = targetRole === USER
    ? await resolveAssignableRole(actor, requestedCustomRole, companyId)
    : null;

  const user = await createAndInvite(actor, {
    companyId,
    username,
    email,
    displayName,
    role: targetRole,
    customRoleId,
  });

  audit(EVENTS.USER_CREATED, actor, {
    userId: user.id,
    targetUsername: user.username,
    targetEmail: user.email,
    role: user.role,
    customRoleId: customRoleId ?? undefined,
    companyId,
  });
  return publicUser(user);
}

async function updateUser(
  actor: Actor,
  id: number,
  { role, customRoleId, displayName }: { role?: unknown; customRoleId?: unknown; displayName?: unknown }
) {
  const target = await requireManageable(actor, id);

  const updates: Record<string, unknown> = {};
  let roleChanged = false;
  let customRoleChanged = false;

  if (role !== undefined && role !== target.role) {
    const newRole = String(role).trim();
    assertCanAssignRole(actor, newRole);
    assertRoleCompanyPairing(newRole, target.company_id);
    updates.role = newRole;
    roleChanged = true;
  }

  const finalRole = (updates.role as string | undefined) ?? target.role;
  if (finalRole !== USER) {
    if (target.custom_role_id) updates.custom_role_id = null;
  } else if (customRoleId !== undefined) {
    const next = await resolveAssignableRole(actor, customRoleId, target.company_id);
    if (next !== (target.custom_role_id ?? null)) {
      updates.custom_role_id = next;
      customRoleChanged = true;
    }
  }
  if (displayName !== undefined) {
    updates.display_name = displayName ? String(displayName).trim().slice(0, 120) : null;
  }

  if (!Object.keys(updates).length) throw fail('VALIDATION_ERROR', 'Nothing to update');
  await userRepository.updateColumns(id, updates);

  if (roleChanged) await revokeAllForUser(id, 'role_changed');

  audit(EVENTS.USER_UPDATED, actor, {
    userId: id,
    targetUsername: target.username,
    roleChanged,
    newRole: roleChanged ? updates.role : undefined,
    customRoleChanged: customRoleChanged || undefined,
    customRoleId: customRoleChanged ? updates.custom_role_id : undefined,
  });
  return currentUser(id);
}

async function deactivateUser(actor: Actor, id: number) {
  const target = await requireManageable(actor, id);

  if (target.status === USER_STATUS.DISABLED) {
    throw fail('CONFLICT', 'That account is already deactivated.');
  }

  await userRepository.updateColumns(id, { status: USER_STATUS.DISABLED });
  await revokeAllForUser(id, 'account_deactivated');

  audit(EVENTS.USER_DEACTIVATED, actor, { userId: id, targetUsername: target.username });
  return currentUser(id);
}

async function activateUser(actor: Actor, id: number) {
  const target = await requireManageable(actor, id);

  if (target.status === USER_STATUS.ACTIVE) throw fail('CONFLICT', 'That account is already active.');
  if (!target.has_password) {
    throw fail(
      'CONFLICT',
      'That account has never been activated. Send a new activation link instead.'
    );
  }

  await userRepository.updateColumns(id, { status: USER_STATUS.ACTIVE });
  audit(EVENTS.USER_ACTIVATED, actor, { userId: id, targetUsername: target.username });
  return currentUser(id);
}

async function reissueActivation(actor: Actor, id: number) {
  const target = await requireManageable(actor, id);

  if (target.status === USER_STATUS.DISABLED) {
    throw fail('CONFLICT', 'Reactivate the account before sending it a new link.');
  }

  const invitation = await withTransaction(async (conn: Queryable) => {
    await userRepository.clearCredential(conn, id);
    await revokeAllForUser(id, 'access_reissued', conn);
    return prepareInvitation(actor, target, { conn });
  });

  await sendEmail(invitation, {
    consequence: "This account's password has been cleared, so it cannot be signed into until a link is delivered.",
  });

  audit(EVENTS.USER_ACTIVATION_RESENT, actor, { userId: id, targetUsername: target.username });
  return currentUser(id);
}

async function deleteUser(actor: Actor, id: number): Promise<void> {
  const target = await requireManageable(actor, id);
  await userRepository.remove(id);
  audit(EVENTS.USER_DELETED, actor, { userId: id, targetUsername: target.username });
}

const USER_SORTS = userRepository.USER_SORTS;
const listUserOptions = userRepository.listOptions;

export {
  USER_SORTS,
  findActor,
  requireUserInScope,
  listUsers,
  listUserOptions,
  createUser,
  updateUser,
  deactivateUser,
  activateUser,
  reissueActivation,
  deleteUser,
};
