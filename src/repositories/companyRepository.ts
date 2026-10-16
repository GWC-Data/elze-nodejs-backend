import config from '../config';
import { Prisma } from '../generated/prisma/client';
import { pagedRows, numericRow, rawRows } from './baseRepository';
import { likePattern, orderBy } from '../tools/listQuery';
import type { Tx } from '../config/database';
import type { ListWindow } from './baseRepository';

const { prisma } = config.database;

interface CompanyFilter {
  companyId?: number;
  active?: boolean;
  search?: string;
}

const COUNTED_FROM = Prisma.sql`
    FROM companies c
    LEFT JOIN (SELECT company_id, COUNT(*)::int AS n,
                      (COUNT(*) FILTER (WHERE status = 'pending'))::int AS pending
                 FROM users GROUP BY company_id) uc ON uc.company_id = c.id
    LEFT JOIN (SELECT company_id, COUNT(*)::int AS n
                 FROM access_control.company_dashboards GROUP BY company_id) dc ON dc.company_id = c.id`;

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
  const conditions: Prisma.Sql[] = [];
  if (filter.companyId !== undefined) conditions.push(Prisma.sql`c.id = ${filter.companyId}`);
  if (filter.active !== undefined) conditions.push(Prisma.sql`c.active = ${filter.active}`);
  if (filter.search) {
    const pattern = likePattern(filter.search);
    conditions.push(Prisma.sql`(c.name ILIKE ${pattern} OR c.slug ILIKE ${pattern})`);
  }
  return conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
}

async function listPage<R>(filter: CompanyFilter, list: ListWindow, shape: (row: any) => R) {
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

async function listOptions(companyId: number | null) {
  const where = companyId === null ? Prisma.empty : Prisma.sql`WHERE id = ${companyId}`;
  return rawRows(prisma, Prisma.sql`SELECT id, name, active FROM companies ${where} ORDER BY lower(name), id`);
}

async function findWithCounts(id: number) {
  const rows = await rawRows(
    prisma,
    Prisma.sql`SELECT ${COUNTED_COLUMNS}, COALESCE(uc.pending, 0) AS "pendingCount"
       ${COUNTED_FROM}
      WHERE c.id = ${id}`
  );
  return rows[0] || null;
}

function asRow(company: { id: number; name: string; slug: string; active: boolean; createdAt: Date }) {
  return {
    id: company.id,
    name: company.name,
    slug: company.slug,
    active: company.active,
    created_at: company.createdAt,
  };
}

async function findRow(id: number) {
  const company = await prisma.company.findUnique({ where: { id } });
  return company ? asRow(company) : null;
}

async function insert(
  { name, slug, createdBy }: { name: string; slug: string; createdBy: number | null },
  tx: Tx = prisma
) {
  return asRow(await tx.company.create({ data: { name, slug, active: true, createdBy } }));
}

async function updateColumns(id: number, changes: { name?: string; active?: boolean }): Promise<void> {
  await prisma.company.update({ where: { id }, data: changes });
}

async function remove(id: number): Promise<boolean> {
  const result = await prisma.company.deleteMany({ where: { id } });
  return result.count > 0;
}

async function platformOverview(): Promise<Record<string, number>> {
  const [companies, companiesActive, users, usersActive, usersPending, companyAdmins, groups, assignments] =
    await Promise.all([
      prisma.company.count(),
      prisma.company.count({ where: { active: true } }),
      prisma.user.count({ where: { companyId: { not: null } } }),
      prisma.user.count({ where: { companyId: { not: null }, status: 'active' } }),
      prisma.user.count({ where: { companyId: { not: null }, status: 'pending' } }),
      prisma.userRole.count({ where: { role: { tier: 'COMPANY_ADMIN' } } }),
      prisma.group.count(),
      prisma.companyDashboard.count(),
    ]);
  return { companies, companiesActive, users, usersActive, usersPending, companyAdmins, groups, assignments };
}

async function workspaceOverview(companyId: number | null): Promise<Record<string, number>> {
  if (companyId === null) {
    return numericRow({ users: 0, usersActive: 0, usersPending: 0, groups: 0, groupsActive: 0, dashboards: 0 });
  }
  const [users, usersActive, usersPending, groups, groupsActive, dashboards] = await Promise.all([
    prisma.user.count({ where: { companyId } }),
    prisma.user.count({ where: { companyId, status: 'active' } }),
    prisma.user.count({ where: { companyId, status: 'pending' } }),
    prisma.group.count({ where: { companyId } }),
    prisma.group.count({ where: { companyId, active: true } }),
    prisma.companyDashboard.count({ where: { companyId } }),
  ]);
  return { users, usersActive, usersPending, groups, groupsActive, dashboards };
}

export {
  COMPANY_SORTS,
  listPage,
  listOptions,
  findWithCounts,
  findRow,
  insert,
  updateColumns,
  remove,
  platformOverview,
  workspaceOverview,
};
export type { CompanyFilter };
