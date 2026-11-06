import config from '../../config';
import { Prisma } from '../../generated/prisma/client';
import { pagedRows } from '../../shared/db/baseRepository';
import { likePattern, orderBy } from '../../shared/db/listQuery';
import { AUDIT_SORTS } from './auditEvents';
import type { ListWindow } from '../../shared/db/baseRepository';
import type { AuditNameIds, AuditNames } from './auditFormatter';

const { prisma } = config.database;

interface AuditRecord {
  event: string;
  actorId: string | null;
  actor: string | null;
  actorCompanyId: string | null;
  companyId: string | null;
  targetUserId: string | null;
  detail: Record<string, unknown>;
}

interface AuditLogRow {
  id: number;
  ts: Date;
  event: string;
  actor_id: string | null;
  actor: string | null;
  actor_company_id: string | null;
  company_id: string | null;
  target_user_id: string | null;
  detail: Prisma.JsonValue;
  company_name: string | null;
}

type AuditScope =
  | { kind: 'all'; hidePlatformTargetsExcept?: string }
  | { kind: 'company'; companyId: string }
  | { kind: 'self'; userId: string };

interface AuditFilter {
  scope: AuditScope;
  event?: string | null;
  categoryEvents?: string[] | null;
  actionEvents?: string[] | null;
  hiddenEvents?: string[];
  hideDashboardDenials?: boolean;
  from?: string | null;
  to?: string | null;
  search?: string | null;
}

const COLUMNS = Prisma.sql`a.id, a.ts, a.event, a.actor_id, a.actor, a.actor_company_id, a.company_id,
                 a.target_user_id, a.detail, c.name AS company_name`;

async function append(record: AuditRecord): Promise<void> {
  await prisma.auditLog.create({
    data: {
      event: record.event,
      actorId: record.actorId,
      actor: record.actor,
      actorCompanyId: record.actorCompanyId,
      companyId: record.companyId,
      targetUserId: record.targetUserId,
      detail: record.detail as Prisma.InputJsonValue,
    },
  });
}

function whereFor(filter: AuditFilter): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];
  const { scope } = filter;
  if (scope.kind === 'company') {
    conditions.push(
      Prisma.sql`(a.actor_company_id = ${scope.companyId}::uuid OR (a.actor_id IS NULL AND a.company_id = ${scope.companyId}::uuid))`
    );
  } else if (scope.kind === 'self') {
    conditions.push(
      Prisma.sql`(a.actor_id = ${scope.userId}::uuid OR (a.actor_id IS NULL AND a.target_user_id = ${scope.userId}::uuid))`
    );
  } else if (scope.hidePlatformTargetsExcept !== undefined) {
    conditions.push(Prisma.sql`(a.target_user_id IS NULL OR a.target_user_id = ${scope.hidePlatformTargetsExcept}::uuid
      OR NOT EXISTS (SELECT 1 FROM access_control.user_roles pur
                       JOIN access_control.roles pr ON pr.id = pur.role_id AND pr.kind = 'system'
                        AND pr.tier IN ('SUPER_ADMIN', 'PLATFORM_ADMIN')
                      WHERE pur.user_id = a.target_user_id))`);
  }
  if (filter.hiddenEvents?.length) conditions.push(Prisma.sql`a.event <> ALL (${filter.hiddenEvents}::text[])`);
  if (filter.hideDashboardDenials)
    conditions.push(Prisma.sql`NOT (a.event = 'access_denied' AND a.detail ? 'dashboardId')`);
  if (filter.event) conditions.push(Prisma.sql`a.event = ${filter.event}`);
  if (filter.categoryEvents) conditions.push(Prisma.sql`a.event = ANY (${filter.categoryEvents}::text[])`);
  if (filter.actionEvents) conditions.push(Prisma.sql`a.event = ANY (${filter.actionEvents}::text[])`);
  if (filter.from) conditions.push(Prisma.sql`a.ts >= ${filter.from}::date`);
  if (filter.to) conditions.push(Prisma.sql`a.ts < (${filter.to}::date + INTERVAL '1 day')`);
  if (filter.search) {
    const pattern = likePattern(filter.search);
    conditions.push(
      Prisma.sql`(a.event ILIKE ${pattern} OR a.actor ILIKE ${pattern} OR a.detail::text ILIKE ${pattern} OR c.name ILIKE ${pattern})`
    );
  }
  return conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
}

async function listPage<R>(filter: AuditFilter, list: ListWindow, shape: (row: AuditLogRow) => R) {
  const where = whereFor(filter);
  const from = Prisma.sql`FROM audit_logs a LEFT JOIN companies c ON c.id = a.company_id`;
  return pagedRows(
    prisma,
    Prisma.sql`SELECT ${COLUMNS}, COUNT(*) OVER () AS "__total"
       ${from}
      ${where}
      ${Prisma.raw(orderBy(list, AUDIT_SORTS, 'a.id DESC'))}
      LIMIT ${list.pageSize} OFFSET ${list.offset}`,
    Prisma.sql`SELECT COUNT(*) AS n ${from} ${where}`,
    shape
  );
}

async function namesFor(ids: AuditNameIds): Promise<AuditNames> {
  const [users, roles, groups, dashboards] = await Promise.all([
    ids.users.length
      ? prisma.user.findMany({ where: { id: { in: ids.users } }, select: { id: true, username: true } })
      : Promise.resolve([]),
    ids.roles.length
      ? prisma.role.findMany({ where: { id: { in: ids.roles }, kind: 'custom' }, select: { id: true, name: true } })
      : Promise.resolve([]),
    ids.groups.length
      ? prisma.group.findMany({ where: { id: { in: ids.groups } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    ids.dashboards.length
      ? prisma.dashboard.findMany({ where: { id: { in: ids.dashboards } }, select: { id: true, title: true } })
      : Promise.resolve([]),
  ]);
  return {
    users: new Map(users.map((row) => [row.id, row.username])),
    roles: new Map(roles.map((row) => [row.id, row.name])),
    groups: new Map(groups.map((row) => [row.id, row.name])),
    dashboards: new Map(dashboards.map((row) => [row.id, row.title])),
  };
}

export { append, listPage, namesFor };
export type { AuditRecord, AuditLogRow, AuditScope, AuditFilter };
