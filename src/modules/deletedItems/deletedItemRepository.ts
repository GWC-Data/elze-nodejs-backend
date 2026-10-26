import config from '../../config';
import { Prisma } from '../../generated/prisma/client';
import { pagedRows, rawRows } from '../../shared/db/baseRepository';
import { likePattern, orderBy } from '../../shared/db/listQuery';
import type { ListWindow } from '../../shared/db/baseRepository';

const { prisma } = config.database;

interface DeletedItemRow {
  type: string;
  id: string;
  name: string;
  detail: string | null;
  company_id: string | null;
  company_name: string | null;
  parent_id: string | null;
  parent_name: string | null;
  deleted_at: Date;
  deleted_by: string | null;
  deleted_by_name: string | null;
}

interface DeletedItemScope {
  companyId: string | null;
  platformAccounts: boolean;
  companies: boolean;
}

interface DeletedItemFilter {
  type?: string;
  id?: string;
  search?: string;
}

const DELETED_ITEM_SORTS: Record<string, string> = {
  deletedAt: 't.deleted_at',
  name: 'lower(t.name)',
  type: 't.type',
  company: 'lower(t.company_name)',
  deletedBy: 'lower(COALESCE(du.display_name, du.username))',
};

const DELETED_ITEMS = Prisma.sql`(
  SELECT 'user'::text AS type, u.id::text AS id, COALESCE(u.display_name, u.username)::text AS name,
         u.email::text AS detail, u.company_id, c.name::text AS company_name,
         NULL::text AS parent_id, NULL::text AS parent_name, u.deleted_at, u.deleted_by
    FROM users u
    LEFT JOIN companies c ON c.id = u.company_id
   WHERE u.deleted_at IS NOT NULL AND (u.company_id IS NULL OR c.deleted_at IS NULL)
  UNION ALL
  SELECT 'group', g.id::text, g.name::text, NULL, g.company_id, c.name::text, NULL, NULL, g.deleted_at, g.deleted_by
    FROM groups g
    JOIN companies c ON c.id = g.company_id
   WHERE g.deleted_at IS NOT NULL AND c.deleted_at IS NULL
  UNION ALL
  SELECT 'role', r.id::text, r.name::text, r.description::text, r.company_id, c.name::text, NULL, NULL,
         r.deleted_at, r.deleted_by
    FROM access_control.roles r
    JOIN companies c ON c.id = r.company_id
   WHERE r.kind = 'custom' AND r.deleted_at IS NOT NULL AND c.deleted_at IS NULL
  UNION ALL
  SELECT 'company', c.id::text, c.name::text, c.slug::text, c.id, c.name::text, NULL, NULL, c.deleted_at, c.deleted_by
    FROM companies c
   WHERE c.deleted_at IS NOT NULL
  UNION ALL
  SELECT 'context', cn.id::text, cn.name::text, cn.provider::text, cn.company_id, c.name::text, NULL, NULL,
         cn.deleted_at, cn.deleted_by
    FROM connections cn
    JOIN companies c ON c.id = cn.company_id
   WHERE cn.deleted_at IS NOT NULL AND c.deleted_at IS NULL
  UNION ALL
  SELECT 'version', v.id::text, v.name::text, ('v' || v.version)::text, v.company_id, c.name::text,
         cn.id::text, cn.name::text, v.deleted_at, v.deleted_by
    FROM context_layer_versions v
    JOIN connections cn ON cn.id = v.connection_id
    JOIN companies c ON c.id = v.company_id
   WHERE v.status = 'published' AND v.deleted_at IS NOT NULL AND cn.deleted_at IS NULL AND c.deleted_at IS NULL
) t
  LEFT JOIN users du ON du.id = t.deleted_by`;

const COLUMNS = Prisma.sql`t.type, t.id, t.name, t.detail, t.company_id, t.company_name, t.parent_id, t.parent_name,
       t.deleted_at, t.deleted_by, COALESCE(du.display_name, du.username) AS deleted_by_name`;

function whereOf(scope: DeletedItemScope, filter: DeletedItemFilter): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (scope.companyId !== null) conditions.push(Prisma.sql`t.company_id = ${scope.companyId}::uuid`);
  if (!scope.companies) conditions.push(Prisma.sql`t.type <> 'company'`);
  if (!scope.platformAccounts) conditions.push(Prisma.sql`NOT (t.type = 'user' AND t.company_id IS NULL)`);
  if (filter.type) conditions.push(Prisma.sql`t.type = ${filter.type}`);
  if (filter.id) conditions.push(Prisma.sql`t.id = ${filter.id}`);
  if (filter.search) {
    const pattern = likePattern(filter.search);
    conditions.push(
      Prisma.sql`(t.name ILIKE ${pattern} OR t.detail ILIKE ${pattern} OR t.parent_name ILIKE ${pattern}
        OR t.company_name ILIKE ${pattern} OR du.username ILIKE ${pattern} OR du.display_name ILIKE ${pattern})`
    );
  }
  return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
}

async function listPage<R>(
  scope: DeletedItemScope,
  filter: DeletedItemFilter,
  list: ListWindow,
  shape: (row: DeletedItemRow) => R
) {
  const from = Prisma.sql`FROM ${DELETED_ITEMS} ${whereOf(scope, filter)}`;
  return pagedRows(
    prisma,
    Prisma.sql`SELECT ${COLUMNS}, COUNT(*) OVER () AS "__total"
       ${from}
      ${Prisma.raw(orderBy(list, DELETED_ITEM_SORTS, 't.type, t.id'))}
      LIMIT ${list.pageSize} OFFSET ${list.offset}`,
    Prisma.sql`SELECT COUNT(*) AS n ${from}`,
    shape
  );
}

async function findOne(scope: DeletedItemScope, type: string, id: string): Promise<DeletedItemRow | null> {
  const rows = await rawRows<DeletedItemRow>(
    prisma,
    Prisma.sql`SELECT ${COLUMNS} FROM ${DELETED_ITEMS} ${whereOf(scope, { type, id })} LIMIT 1`
  );
  return rows[0] || null;
}

export { DELETED_ITEM_SORTS, listPage, findOne };
export type { DeletedItemRow, DeletedItemScope, DeletedItemFilter };
