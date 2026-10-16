import config from '../config';
import * as userRepository from '../repositories/userRepository';
import { fail } from '../tools/AppError';
import { publicUser, userListItem } from '../views/serializers/userSerializer';
import { resolveTargetCompany, assertCanAssignRole, assertCanManageUser } from './authorizationService';
import { assertRoleCompanyPairing } from './roleService';
import { requireActiveCompany } from './companyService';
import { resolveAssignableRole, builtInRoleId } from './companyRoleService';
import { createAndInvite, prepareInvitation } from './onboardingService';
import { sendEmail } from './emailService';
import { revokeAllForUser } from './tokenService';
import { audit, EVENTS } from './auditService';
import { USER, scopeOfTier } from '../constants/roles';
import { effectiveFeatures, featureKeys, featureKeysOf } from './catalogueService';
import { USER_STATUS, USER_STATUSES } from '../constants/statuses';
import type { Actor } from '../types/actor';
import type { Tx } from '../config/database';
import type { ListWindow } from '../repositories/baseRepository';

const { withTransaction } = config.database;

async function findActor(id: number) {
  const row = await userRepository.findActorRow(id);
  if (!row) return null;
  const scopes: Record<string, unknown[]> = {};
  for (const [dimension, value] of row.scopes) {
    scopes[dimension] ??= [];
    scopes[dimension].push(value);
  }
  const features = row.company_id ? effectiveFeatures(featureKeysOf(row.feature_ids)) : featureKeys();
  return {
    user: row,
    permissions: [...(row.permissions as string[])],
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
  const filter: userRepository.UserFilter = {};

  if (actor.isPlatform) {
    if (companyId !== undefined && companyId !== null && companyId !== '') {
      const id = Number(companyId);
      if (!Number.isInteger(id) || id < 1) throw fail('VALIDATION_ERROR', 'companyId must be a positive integer.');
      filter.companyId = id;
    }
  } else {
    filter.companyId = actor.companyId as number;
  }
  if (role) {
    if (!scopeOfTier(String(role))) throw fail('VALIDATION_ERROR', `Unknown role: "${role}"`);
    filter.role = String(role);
  }
  if (status) {
    if (!USER_STATUSES.includes(String(status))) {
      throw fail('VALIDATION_ERROR', `status must be one of: ${USER_STATUSES.join(', ')}.`);
    }
    filter.status = String(status);
  }
  if (list.search) filter.search = list.search;

  return userRepository.listPage(filter, list, (row: Record<string, any>) => userListItem(row, actor.isPlatform));
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
  const roleId = customRoleId ?? (await builtInRoleId(targetRole, companyId));

  const user = await createAndInvite(actor, {
    companyId,
    username,
    email,
    displayName,
    role: targetRole,
    roleId,
  });

  audit(EVENTS.USER_CREATED, actor, {
    userId: user.id,
    targetUsername: user.username,
    targetEmail: user.email,
    role: user.role,
    roleId,
    roleName: user.role_name,
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

  const updates: { displayName?: string | null } = {};
  let roleChanged = false;
  let finalRole: string = target.role;

  if (role !== undefined && role !== target.role) {
    finalRole = String(role).trim();
    assertCanAssignRole(actor, finalRole);
    assertRoleCompanyPairing(finalRole, target.company_id);
    roleChanged = true;
  }

  let nextRoleId: string = target.role_id;
  if (finalRole !== USER) {
    if (roleChanged) nextRoleId = await builtInRoleId(finalRole, target.company_id);
  } else if (customRoleId !== undefined) {
    const custom = await resolveAssignableRole(actor, customRoleId, target.company_id);
    nextRoleId = custom ?? (await builtInRoleId(USER, target.company_id));
  } else if (roleChanged) {
    nextRoleId = await builtInRoleId(USER, target.company_id);
  }
  const roleIdChanged = nextRoleId !== target.role_id;
  const customRoleChanged = roleIdChanged && !roleChanged;

  if (displayName !== undefined) {
    updates.displayName = displayName ? String(displayName).trim().slice(0, 120) : null;
  }

  if (!Object.keys(updates).length && !roleIdChanged) throw fail('VALIDATION_ERROR', 'Nothing to update');
  await userRepository.updateColumns(id, updates);
  if (roleIdChanged) await userRepository.setRole(id, nextRoleId, actor.id);

  if (roleChanged) await revokeAllForUser(id, 'role_changed');

  audit(EVENTS.USER_UPDATED, actor, {
    userId: id,
    targetUsername: target.username,
    roleChanged,
    newRole: roleChanged ? finalRole : undefined,
    customRoleChanged: customRoleChanged || undefined,
    roleId: roleIdChanged ? nextRoleId : undefined,
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

  const invitation = await withTransaction(async (conn: Tx) => {
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
  requireManageable,
  listUsers,
  listUserOptions,
  createUser,
  updateUser,
  deactivateUser,
  activateUser,
  reissueActivation,
  deleteUser,
};
