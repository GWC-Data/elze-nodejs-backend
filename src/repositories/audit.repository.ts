import config from '../config';
import { T } from '../models/rbac.model';
import { pagedRows } from './base.repository';
import { likePattern, orderBy } from '../tools/listQuery';
import { AUDIT_SORTS } from '../constants/auditEvents';
import type { ListWindow } from './base.repository';

const { db } = config.database;

interface AuditRecord {
  event: string;
  actorId: number | null;
  actor: string | null;
  actorCompanyId: number | null;
  companyId: number | null;
  targetUserId: number | null;
  detail: Record<string, unknown>;
}

// Which rows a reader may see: everything, one company's, or one account's own.
type AuditScope =
  | { kind: 'all' }
  | { kind: 'company'; companyId: number }
  | { kind: 'self'; userId: number };

interface AuditFilter {
  scope: AuditScope;
  event?: string | null;
  // Event-name prefixes, any of which matches (AUDIT_CATEGORIES).
  eventPrefixes?: string[] | null;
  // Event-name suffixes, any of which matches (AUDIT_ACTIONS).
  eventSuffixes?: string[] | null;
  // Inclusive calendar days, 'YYYY-MM-DD', in the database's time zone.
  from?: string | null;
  to?: string | null;
  search?: string | null;
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

const COLUMNS = `a.id, a.ts, a.event, a.actor_id, a.actor, a.actor_company_id, a.company_id,
                 a.target_user_id, a.detail, c.name AS company_name`;

async function append(record: AuditRecord): Promise<void> {
  await db.query(
    `INSERT INTO ${T.auditLogs}
       (event, actor_id, actor, actor_company_id, company_id, target_user_id, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?::jsonb)`,
    [
      record.event,
      record.actorId,
      record.actor,
      record.actorCompanyId,
      record.companyId,
      record.targetUserId,
      JSON.stringify(record.detail),
    ]
  );
}

function whereFor(filter: AuditFilter): { sql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  const { scope } = filter;
  if (scope.kind === 'company') {
    where.push('(a.company_id = ? OR a.actor_company_id = ?)');
    params.push(scope.companyId, scope.companyId);
  } else if (scope.kind === 'self') {
    where.push('(a.actor_id = ? OR a.target_user_id = ?)');
    params.push(scope.userId, scope.userId);
  }
  if (filter.event) {
    where.push('a.event = ?');
    params.push(filter.event);
  }
  if (filter.eventPrefixes && filter.eventPrefixes.length) {
    where.push('a.event LIKE ANY (?::text[])');
    params.push(filter.eventPrefixes.map((prefix) => `${escapeLike(prefix)}%`));
  }
  if (filter.eventSuffixes && filter.eventSuffixes.length) {
    where.push('a.event LIKE ANY (?::text[])');
    params.push(filter.eventSuffixes.map((suffix) => `%${escapeLike(suffix)}`));
  }
  if (filter.from) {
    where.push('a.ts >= ?::date');
    params.push(filter.from);
  }
  if (filter.to) {
    where.push("a.ts < (?::date + INTERVAL '1 day')");
    params.push(filter.to);
  }
  if (filter.search) {
    const pattern = likePattern(filter.search);
    where.push(`(a.event ILIKE ? OR a.actor ILIKE ? OR a.detail::text ILIKE ? OR c.name ILIKE ?)`);
    params.push(pattern, pattern, pattern, pattern);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

async function listPage<R>(filter: AuditFilter, list: ListWindow, shape: (row: any) => R) {
  const where = whereFor(filter);
  const from = `FROM ${T.auditLogs} a LEFT JOIN ${T.companies} c ON c.id = a.company_id`;
  return pagedRows(
    db,
    `SELECT ${COLUMNS}, COUNT(*) OVER () AS "__total"
       ${from}
      ${where.sql}
      ${orderBy(list, AUDIT_SORTS, 'a.id DESC')}
      LIMIT ? OFFSET ?`,
    [...where.params, list.pageSize, list.offset],
    `SELECT COUNT(*) AS n ${from} ${where.sql}`,
    where.params,
    shape
  );
}

export { append, listPage };
export type { AuditRecord, AuditScope, AuditFilter };
