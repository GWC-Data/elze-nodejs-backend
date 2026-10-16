import config from '../config';
import { Prisma } from '../generated/prisma/client';
import { pagedRows } from './baseRepository';
import { likePattern, orderBy } from '../tools/listQuery';
import { AUDIT_SORTS } from '../constants/auditEvents';
import type { ListWindow } from './baseRepository';

const { prisma } = config.database;

interface AuditRecord {
  event: string;
  actorId: number | null;
  actor: string | null;
  actorCompanyId: number | null;
  companyId: number | null;
  targetUserId: number | null;
  detail: Record<string, unknown>;
}

type AuditScope = { kind: 'all' } | { kind: 'company'; companyId: number } | { kind: 'self'; userId: number };

interface AuditFilter {
  scope: AuditScope;
  event?: string | null;
  categoryEvents?: string[] | null;
  actionEvents?: string[] | null;
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
    conditions.push(Prisma.sql`(a.company_id = ${scope.companyId} OR a.actor_company_id = ${scope.companyId})`);
  } else if (scope.kind === 'self') {
    conditions.push(Prisma.sql`(a.actor_id = ${scope.userId} OR a.target_user_id = ${scope.userId})`);
  }
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

async function listPage<R>(filter: AuditFilter, list: ListWindow, shape: (row: any) => R) {
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

export { append, listPage };
export type { AuditRecord, AuditScope, AuditFilter };
