import config from '../config';
import { T } from '../models/rbac.model';
import { pagedRows, numericRow } from './base.repository';
import { orderBy } from '../tools/listQuery';
import type { Queryable } from '../config/pgPool';
import type { ListWindow } from './base.repository';

const { db } = config.database;

const COUNTED_FROM = `
    FROM ${T.companies} c
    LEFT JOIN (SELECT company_id, COUNT(*) AS n,
                      COUNT(*) FILTER (WHERE status = 'pending') AS pending
                 FROM ${T.users} GROUP BY company_id) uc ON uc.company_id = c.id
    LEFT JOIN (SELECT company_id, COUNT(*) AS n
                 FROM ${T.companyDashboards} GROUP BY company_id) dc ON dc.company_id = c.id`;

const COUNTED_COLUMNS = `c.id, c.name, c.slug, c.active, c.created_at,
         COALESCE(uc.n, 0) AS "userCount", COALESCE(dc.n, 0) AS "dashboardCount",
         COALESCE((SELECT array_agg(f.feature_id ORDER BY f.feature_id) FROM ${T.companyFeatures} f
                    WHERE f.company_id = c.id), '{}') AS features`;

const COMPANY_SORTS: Record<string, string> = {
  name: 'lower(c.name)',
  status: 'c.active',
  users: 'COALESCE(uc.n, 0)',
  dashboards: 'COALESCE(dc.n, 0)',
  created: 'c.created_at',
};

async function listPage<R>(where: string[], params: unknown[], list: ListWindow, shape: (row: any) => R) {
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return pagedRows(
    db,
    `SELECT ${COUNTED_COLUMNS}, COUNT(*) OVER () AS "__total"
       ${COUNTED_FROM}
      ${whereSql}
      ${orderBy(list, COMPANY_SORTS, 'c.id')}
      LIMIT ? OFFSET ?`,
    [...params, list.pageSize, list.offset],
    `SELECT COUNT(*) AS n FROM ${T.companies} c ${whereSql}`,
    params,
    shape
  );
}

async function listOptions(companyId: number | null) {
  const scope = companyId === null
    ? { sql: '', params: [] }
    : { sql: 'WHERE id = ?', params: [companyId] };
  const { rows } = await db.query(
    `SELECT id, name, active FROM ${T.companies} ${scope.sql} ORDER BY lower(name), id`,
    scope.params
  );
  return rows;
}

async function findWithCounts(id: number) {
  const { rows } = await db.query(
    `SELECT ${COUNTED_COLUMNS}, COALESCE(uc.pending, 0) AS "pendingCount"
       ${COUNTED_FROM}
      WHERE c.id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function findRow(id: number) {
  const { rows } = await db.query(
    `SELECT id, name, slug, active, created_at FROM ${T.companies} WHERE id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function insert(
  { name, slug, createdBy }: { name: string; slug: string; createdBy: number | null },
  conn?: Queryable
) {
  const client = conn || db;
  const { rows } = await client.query(
    `INSERT INTO ${T.companies} (name, slug, active, created_by) VALUES (?, ?, TRUE, ?)
     RETURNING id, name, slug, active, created_at`,
    [name, slug, createdBy]
  );
  return rows[0];
}

async function updateColumns(id: number, updates: string[], params: unknown[]): Promise<void> {
  await db.query(`UPDATE ${T.companies} SET ${updates.join(', ')} WHERE id = ?`, [...params, id]);
}

async function remove(id: number): Promise<boolean> {
  const result = await db.query(`DELETE FROM ${T.companies} WHERE id = ?`, [id]);
  return result.rowCount! > 0;
}

async function platformOverview(): Promise<Record<string, number>> {
  const { rows } = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM ${T.companies})                                  AS "companies",
       (SELECT COUNT(*) FROM ${T.companies} WHERE active)                     AS "companiesActive",
       (SELECT COUNT(*) FROM ${T.users} WHERE company_id IS NOT NULL)         AS "users",
       (SELECT COUNT(*) FROM ${T.users} WHERE status = 'active'
                                          AND company_id IS NOT NULL)         AS "usersActive",
       (SELECT COUNT(*) FROM ${T.users} WHERE status = 'pending'
                                          AND company_id IS NOT NULL)         AS "usersPending",
       (SELECT COUNT(*) FROM ${T.users} WHERE role = 'COMPANY_ADMIN')         AS "companyAdmins",
       (SELECT COUNT(*) FROM ${T.groups})                                     AS "groups",
       (SELECT COUNT(*) FROM ${T.companyDashboards})                          AS "assignments"`
  );
  return numericRow(rows[0]);
}

async function workspaceOverview(companyId: number | null): Promise<Record<string, number>> {
  const { rows } = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM ${T.users}  WHERE company_id = ?)                  AS "users",
       (SELECT COUNT(*) FROM ${T.users}  WHERE company_id = ? AND status = 'active')  AS "usersActive",
       (SELECT COUNT(*) FROM ${T.users}  WHERE company_id = ? AND status = 'pending') AS "usersPending",
       (SELECT COUNT(*) FROM ${T.groups} WHERE company_id = ?)                  AS "groups",
       (SELECT COUNT(*) FROM ${T.groups} WHERE company_id = ? AND active)       AS "groupsActive",
       (SELECT COUNT(*) FROM ${T.companyDashboards} WHERE company_id = ?)       AS "dashboards"`,
    [companyId, companyId, companyId, companyId, companyId, companyId]
  );
  return numericRow(rows[0]);
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
