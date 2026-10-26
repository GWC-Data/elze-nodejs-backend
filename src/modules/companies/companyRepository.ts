import config from '../../config';
import { Prisma } from '../../generated/prisma/client';
import { pagedRows, numericRow, rawRows } from '../../shared/db/baseRepository';
import { likePattern, orderBy } from '../../shared/db/listQuery';
import { DELETED, NOT_DELETED, RESTORED, notDeleted, notDeletedRef, softDeletion } from '../../shared/db/softDelete';
import type { Tx } from '../../shared/db/database';
import type { ListWindow } from '../../shared/db/baseRepository';

const { prisma, withTransaction } = config.database;

interface CompanyFilter {
  companyId?: string;
  active?: boolean;
  search?: string;
}

interface CompanyRow {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  created_at: Date;
}

interface CompanyListRow extends CompanyRow {
  userCount: number;
  dashboardCount: number;
  feature_ids: string[];
}

interface CompanyCountsRow extends CompanyListRow {
  pendingCount: number;
}

interface CompanyOptionRow {
  id: string;
  name: string;
  active: boolean;
}

const COUNTED_FROM = Prisma.sql`
    FROM companies c
    LEFT JOIN (SELECT company_id, COUNT(*)::int AS n,
                      (COUNT(*) FILTER (WHERE status = 'pending'))::int AS pending
                 FROM users WHERE deleted_at IS NULL GROUP BY company_id) uc ON uc.company_id = c.id
    LEFT JOIN (SELECT cd.company_id, COUNT(*)::int AS n
                 FROM access_control.company_dashboards cd
                WHERE ${notDeletedRef('dashboards', 'cd.dashboard_id')}
                GROUP BY cd.company_id) dc ON dc.company_id = c.id`;

const COUNTED_COLUMNS = Prisma.sql`c.id, c.name, c.slug, c.active, c.created_at,
         COALESCE(uc.n, 0) AS "userCount", COALESCE(dc.n, 0) AS "dashboardCount",
         COALESCE((SELECT f.feature_ids FROM access_control.company_features f WHERE f.company_id = c.id), '{}') AS feature_ids`;

const COMPANY_SORTS: Record<string, string> = {
  name: 'lower(c.name)',
  status: 'c.active',
  users: 'COALESCE(uc.n, 0)',
  dashboards: 'COALESCE(dc.n, 0)',
  created: 'c.created_at',
};

function whereOf(filter: CompanyFilter): Prisma.Sql {
  const conditions: Prisma.Sql[] = [notDeleted('c')];
  if (filter.companyId !== undefined) conditions.push(Prisma.sql`c.id = ${filter.companyId}::uuid`);
  if (filter.active !== undefined) conditions.push(Prisma.sql`c.active = ${filter.active}`);
  if (filter.search) {
    const pattern = likePattern(filter.search);
    conditions.push(Prisma.sql`(c.name ILIKE ${pattern} OR c.slug ILIKE ${pattern})`);
  }
  return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
}

async function listPage<R>(filter: CompanyFilter, list: ListWindow, shape: (row: CompanyListRow) => R) {
  const where = whereOf(filter);
  return pagedRows(
    prisma,
    Prisma.sql`SELECT ${COUNTED_COLUMNS}, COUNT(*) OVER () AS "__total"
       ${COUNTED_FROM}
      ${where}
      ${Prisma.raw(orderBy(list, COMPANY_SORTS, 'c.id'))}
      LIMIT ${list.pageSize} OFFSET ${list.offset}`,
    Prisma.sql`SELECT COUNT(*) AS n FROM companies c ${where}`,
    shape
  );
}

async function listOptions(companyId: string | null): Promise<CompanyOptionRow[]> {
  const only = companyId === null ? Prisma.empty : Prisma.sql`AND id = ${companyId}::uuid`;
  return rawRows<CompanyOptionRow>(
    prisma,
    Prisma.sql`SELECT id, name, active FROM companies WHERE deleted_at IS NULL ${only} ORDER BY lower(name), id`
  );
}

async function findWithCounts(id: string): Promise<CompanyCountsRow | null> {
  const rows = await rawRows<CompanyCountsRow>(
    prisma,
    Prisma.sql`SELECT ${COUNTED_COLUMNS}, COALESCE(uc.pending, 0) AS "pendingCount"
       ${COUNTED_FROM}
      WHERE c.id = ${id}::uuid AND ${notDeleted('c')}`
  );
  return rows[0] || null;
}

function asRow(company: { id: string; name: string; slug: string; active: boolean; createdAt: Date }): CompanyRow {
  return {
    id: company.id,
    name: company.name,
    slug: company.slug,
    active: company.active,
    created_at: company.createdAt,
  };
}

async function findRow(
  id: string,
  { includeDeleted = false }: { includeDeleted?: boolean } = {}
): Promise<CompanyRow | null> {
  const company = await prisma.company.findFirst({ where: { id, ...(includeDeleted ? {} : NOT_DELETED) } });
  return company ? asRow(company) : null;
}

async function insert(
  { name, slug, createdBy }: { name: string; slug: string; createdBy: string | null },
  tx: Tx = prisma
) {
  return asRow(await tx.company.create({ data: { name, slug, active: true, createdBy } }));
}

async function updateColumns(id: string, changes: { name?: string; active?: boolean }): Promise<void> {
  await prisma.company.update({ where: { id }, data: changes });
}

async function softDelete(id: string, deletedBy: string | null): Promise<boolean> {
  const deletion = softDeletion(deletedBy);
  return withTransaction(async (tx) => {
    const result = await tx.company.updateMany({ where: { id, ...NOT_DELETED }, data: { ...deletion, active: false } });
    if (!result.count) return false;
    await tx.group.updateMany({ where: { companyId: id, ...NOT_DELETED }, data: { ...deletion, active: false } });
    await tx.role.updateMany({ where: { companyId: id, ...NOT_DELETED }, data: deletion });
    await tx.dashboard.updateMany({ where: { companyId: id, ...NOT_DELETED }, data: deletion });
    await tx.connection.updateMany({ where: { companyId: id, ...NOT_DELETED }, data: deletion });
    return true;
  });
}

async function discard(id: string): Promise<void> {
  await prisma.company.deleteMany({ where: { id } });
}

async function restore(id: string): Promise<boolean> {
  return withTransaction(async (tx) => {
    const row = await tx.company.findFirst({ where: { id, ...DELETED }, select: { deletedAt: true, deletedBy: true } });
    if (!row) return false;
    const deletedWithIt = { companyId: id, deletedAt: row.deletedAt, deletedBy: row.deletedBy };
    await tx.company.updateMany({ where: { id }, data: RESTORED });
    await tx.group.updateMany({ where: deletedWithIt, data: RESTORED });
    await tx.role.updateMany({ where: deletedWithIt, data: RESTORED });
    await tx.dashboard.updateMany({ where: deletedWithIt, data: RESTORED });
    await tx.connection.updateMany({ where: deletedWithIt, data: RESTORED });
    return true;
  });
}

async function platformOverview(): Promise<Record<string, number>> {
  const [companies, companiesActive, users, usersActive, usersPending, companyAdmins, groups] = await Promise.all([
    prisma.company.count({ where: NOT_DELETED }),
    prisma.company.count({ where: { active: true, ...NOT_DELETED } }),
    prisma.user.count({ where: { companyId: { not: null }, ...NOT_DELETED } }),
    prisma.user.count({ where: { companyId: { not: null }, status: 'active', ...NOT_DELETED } }),
    prisma.user.count({ where: { companyId: { not: null }, status: 'pending', ...NOT_DELETED } }),
    prisma.userRole.count({ where: { role: { tier: 'COMPANY_ADMIN' }, user: NOT_DELETED } }),
    prisma.group.count({ where: NOT_DELETED }),
  ]);
  return { companies, companiesActive, users, usersActive, usersPending, companyAdmins, groups };
}

async function workspaceOverview(companyId: string | null): Promise<Record<string, number>> {
  if (companyId === null) {
    return numericRow({ users: 0, usersActive: 0, usersPending: 0, groups: 0, groupsActive: 0 });
  }
  const [users, usersActive, usersPending, groups, groupsActive] = await Promise.all([
    prisma.user.count({ where: { companyId, ...NOT_DELETED } }),
    prisma.user.count({ where: { companyId, status: 'active', ...NOT_DELETED } }),
    prisma.user.count({ where: { companyId, status: 'pending', ...NOT_DELETED } }),
    prisma.group.count({ where: { companyId, ...NOT_DELETED } }),
    prisma.group.count({ where: { companyId, active: true, ...NOT_DELETED } }),
  ]);
  return { users, usersActive, usersPending, groups, groupsActive };
}

export {
  COMPANY_SORTS,
  listPage,
  listOptions,
  findWithCounts,
  findRow,
  insert,
  updateColumns,
  softDelete,
  discard,
  restore,
  platformOverview,
  workspaceOverview,
};
export type { CompanyFilter, CompanyRow, CompanyListRow, CompanyCountsRow, CompanyOptionRow };
