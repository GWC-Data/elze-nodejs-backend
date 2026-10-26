import * as deletedItemRepository from './deletedItemRepository';
import * as userService from '../users/userService';
import * as groupService from '../groups/groupService';
import * as companyRoleService from '../roles/companyRoleService';
import * as companyService from '../companies/companyService';
import * as contextLayerService from '../contextLayer/contextLayerService';
import { assertPermission, seesPlatformAccounts } from '../auth/authorizationService';
import { fail } from '../../shared/errors/AppError';
import { requireUuid } from '../../shared/validation/commonValidator';
import { DELETED_ITEM_TYPES, shapeDeletedItem } from './deletedItemSerializer';
import type { DeletedItem, DeletedItemType } from './deletedItemSerializer';
import type { DeletedItemScope } from './deletedItemRepository';
import type { Actor } from '../../shared/types/actor';
import type { ListQuery } from '../../shared/validation/listValidator';

const DELETED_ITEM_SORTS = deletedItemRepository.DELETED_ITEM_SORTS;

const DELETE_PERMISSION: Record<DeletedItemType, string> = {
  user: 'user.delete',
  group: 'group.delete',
  role: 'role.delete',
  company: 'company.delete',
  context: 'context.delete',
  version: 'context.delete',
};

const RESTORE: Record<DeletedItemType, (actor: Actor, item: DeletedItem) => Promise<unknown>> = {
  user: (actor, item) => userService.restoreUser(actor, item.id),
  group: (actor, item) => groupService.restoreGroup(actor, item.id),
  role: (actor, item) => companyRoleService.restoreRole(actor, item.id),
  company: (actor, item) => companyService.restoreCompany(actor, item.id),
  context: (actor, item) => contextLayerService.restoreConnection(actor, item.id),
  version: (actor, item) => contextLayerService.restoreVersion(actor, item.parent?.id, item.id),
};

const PURGE: Record<DeletedItemType, (actor: Actor, item: DeletedItem) => Promise<unknown>> = {
  user: (actor, item) => userService.deleteUser(actor, item.id, { permanent: true }),
  group: (actor, item) => groupService.deleteGroup(actor, item.id, { permanent: true }),
  role: (actor, item) => companyRoleService.deleteRole(actor, item.id, { permanent: true }),
  company: (actor, item) => companyService.deleteCompany(actor, item.id, { permanent: true }),
  context: (actor, item) => contextLayerService.deleteConnection(actor, item.id, { permanent: true }),
  version: (actor, item) => contextLayerService.deleteVersion(actor, item.parent?.id, item.id, { permanent: true }),
};

function requireType(value: unknown): DeletedItemType {
  const type = String(value ?? '') as DeletedItemType;
  if (!DELETED_ITEM_TYPES.includes(type)) {
    throw fail('VALIDATION_ERROR', `type must be one of: ${DELETED_ITEM_TYPES.join(', ')}.`);
  }
  return type;
}

function scopeFor(actor: Actor, companyId?: unknown): DeletedItemScope {
  if (!actor.isPlatform) return { companyId: actor.companyId, platformAccounts: false, companies: false };
  const requested =
    companyId === undefined || companyId === null || companyId === '' ? null : requireUuid(companyId, 'companyId');
  return { companyId: requested, platformAccounts: seesPlatformAccounts(actor), companies: true };
}

async function listDeletedItems(
  actor: Actor,
  list: ListQuery,
  { type, companyId }: { type?: unknown; companyId?: unknown } = {}
) {
  const filter = { search: list.search, type: type === undefined || type === '' ? undefined : requireType(type) };
  return deletedItemRepository.listPage(scopeFor(actor, companyId), filter, list, shapeDeletedItem);
}

async function requireDeletedItem(actor: Actor, type: unknown, id: unknown): Promise<DeletedItem> {
  const kind = requireType(type);
  const row = await deletedItemRepository.findOne(scopeFor(actor), kind, String(id ?? ''));
  if (!row) throw fail('RESOURCE_NOT_FOUND', 'That item is not among the deleted items.');
  assertPermission(actor, DELETE_PERMISSION[kind]);
  return shapeDeletedItem(row);
}

async function restoreDeletedItem(actor: Actor, type: unknown, id: unknown) {
  const item = await requireDeletedItem(actor, type, id);
  await RESTORE[item.type](actor, item);
  return { restored: true, item };
}

async function purgeDeletedItem(actor: Actor, type: unknown, id: unknown) {
  const item = await requireDeletedItem(actor, type, id);
  await PURGE[item.type](actor, item);
  return { deleted: true, permanent: true, item };
}

export { DELETED_ITEM_SORTS, listDeletedItems, restoreDeletedItem, purgeDeletedItem };
