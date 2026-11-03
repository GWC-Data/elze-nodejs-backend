import type { DeletedItemRow } from './deletedItemRepository';

const DELETED_ITEM_TYPES = ['user', 'group', 'role', 'company', 'context', 'version'] as const;
type DeletedItemType = (typeof DELETED_ITEM_TYPES)[number];

interface DeletedItem {
  type: DeletedItemType;
  id: string;
  name: string;
  detail: string | null;
  companyId: string | null;
  companyName: string | null;
  parent: { id: string; name: string | null } | null;
  deletedAt: Date;
  deletedBy: { id: string; name: string | null } | null;
}

function shapeDeletedItem(row: DeletedItemRow): DeletedItem {
  return {
    type: row.type as DeletedItemType,
    id: row.id,
    name: row.name,
    detail: row.detail ?? null,
    companyId: row.company_id ?? null,
    companyName: row.company_name ?? null,
    parent: row.parent_id ? { id: row.parent_id, name: row.parent_name ?? null } : null,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by === null ? null : { id: row.deleted_by, name: row.deleted_by_name ?? null },
  };
}

export { DELETED_ITEM_TYPES, shapeDeletedItem };
export type { DeletedItem, DeletedItemType };
