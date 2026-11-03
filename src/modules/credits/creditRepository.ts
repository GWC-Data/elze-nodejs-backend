import config from '../../config';
import { Prisma } from '../../generated/prisma/client';
import { pagedRows, rawRows } from '../../shared/db/baseRepository';
import { likePattern, orderBy } from '../../shared/db/listQuery';
import type { Tx } from '../../shared/db/database';
import type { ListWindow } from '../../shared/db/baseRepository';

const { prisma, withTransaction } = config.database;

const REFUND_WINDOW_MINUTES = 15;

interface RateRow {
  action: string;
  label: string;
  description: string | null;
  credits: number;
  sort_order: number;
  updated_at: Date;
}

interface ChargeInput {
  companyId: string;
  userId: string;
  action: string;
  contextId: string | null;
  sessionId: string | null;
  exempt: boolean;
}

type ChargeResult =
  | { ok: true; id: string; credits: number; balance: number }
  | { ok: false; scope: 'company' | 'user'; available: number; required: number };

interface RefundResult {
  refunded: boolean;
  credits: number;
}

interface AllocationResult {
  ok: boolean;
  id: string | null;
  balance: number;
}

interface MemberRow {
  id: string;
  username: string;
  email: string;
  display_name: string | null;
  role: string | null;
  status: string;
  credit_limit: number | null;
  used: number;
}

interface CompanyCreditRow {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  balance: number;
  allocated: number;
  used: number;
  last_used_at: Date | null;
}

interface LedgerRow {
  id: string;
  kind: string;
  credits: number;
  balance_after: number;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  user_company_id: string | null;
  action: string | null;
  action_label: string | null;
  context_id: string | null;
  context_name: string | null;
  session_id: string | null;
  note: string | null;
  refunded: boolean;
  created_at: Date;
}

interface LedgerFilter {
  companyId: string;
  userId?: string;
  kind?: string;
  action?: string;
  search?: string;
}

interface UsageByAction {
  action: string;
  label: string | null;
  credits: number;
  runs: number;
}

interface UsageByDay {
  day: string;
  action: string;
  credits: number;
}

interface CompanyTotals {
  balance: number;
  allocated: number;
  used: number;
  used_30_days: number;
  runs: number;
}

const COMPANY_SORTS: Record<string, string> = {
  name: 'lower(c.name)',
  balance: 'balance',
  allocated: 'allocated',
  used: 'used',
  lastUsedAt: 'last_used_at',
};

const LEDGER_SORTS: Record<string, string> = {
  createdAt: 'e.created_at',
  credits: 'e.credits',
};

const cents = (value: number): number => Math.round(value * 100);

async function listRates(): Promise<RateRow[]> {
  return rawRows<RateRow>(
    prisma,
    Prisma.sql`SELECT action, label, description, credits, sort_order, updated_at
                 FROM credit_rates ORDER BY sort_order, action`
  );
}

async function findRate(action: string, tx: Tx = prisma): Promise<RateRow | null> {
  const rows = await rawRows<RateRow>(
    tx,
    Prisma.sql`SELECT action, label, description, credits, sort_order, updated_at
                 FROM credit_rates WHERE action = ${action}`
  );
  return rows[0] || null;
}

async function updateRate(action: string, credits: number, updatedBy: string): Promise<RateRow | null> {
  const rows = await rawRows<RateRow>(
    prisma,
    Prisma.sql`UPDATE credit_rates SET credits = ${credits}::numeric, updated_by = ${updatedBy}::uuid, updated_at = now()
                WHERE action = ${action}
            RETURNING action, label, description, credits, sort_order, updated_at`
  );
  return rows[0] || null;
}

async function lockWallet(tx: Tx, companyId: string): Promise<number> {
  await tx.$executeRaw`INSERT INTO company_credits (company_id) VALUES (${companyId}::uuid)
                       ON CONFLICT (company_id) DO NOTHING`;
  const rows = await rawRows<{ balance: number }>(
    tx,
    Prisma.sql`SELECT balance FROM company_credits WHERE company_id = ${companyId}::uuid FOR UPDATE`
  );
  return rows[0].balance;
}

async function moveBalance(tx: Tx, companyId: string, credits: number): Promise<number> {
  const rows = await rawRows<{ balance: number }>(
    tx,
    Prisma.sql`UPDATE company_credits SET balance = balance + ${credits}::numeric, updated_at = now()
                WHERE company_id = ${companyId}::uuid RETURNING balance`
  );
  return rows[0].balance;
}

async function totalUse(tx: Tx, companyId: string, userId: string): Promise<number> {
  const rows = await rawRows<{ used: number }>(
    tx,
    Prisma.sql`SELECT COALESCE(-SUM(credits), 0) AS used FROM company_credit_ledger
                WHERE company_id = ${companyId}::uuid AND user_id = ${userId}::uuid
                  AND kind IN ('usage', 'refund')`
  );
  return rows[0].used;
}

async function creditLimit(tx: Tx, userId: string): Promise<number | null> {
  const rows = await rawRows<{ credit_limit: number }>(
    tx,
    Prisma.sql`SELECT credit_limit FROM user_credit_limits WHERE user_id = ${userId}::uuid`
  );
  return rows[0] ? rows[0].credit_limit : null;
}

async function insertEntry(
  tx: Tx,
  entry: {
    companyId: string;
    kind: 'allocation' | 'usage' | 'refund';
    credits: number;
    balanceAfter: number;
    userId: string | null;
    action?: string | null;
    contextId?: string | null;
    sessionId?: string | null;
    refundOf?: string | null;
    note?: string | null;
  }
): Promise<string | null> {
  const rows = await rawRows<{ id: string }>(
    tx,
    Prisma.sql`INSERT INTO company_credit_ledger
                 (company_id, kind, credits, balance_after, user_id, action, context_id, session_id, refund_of, note)
               VALUES (${entry.companyId}::uuid, ${entry.kind}::credit_entry_kind, ${entry.credits}::numeric, ${entry.balanceAfter}::numeric,
                       ${entry.userId}::uuid, ${entry.action ?? null}, ${entry.contextId ?? null}::uuid,
                       ${entry.sessionId ?? null}, ${entry.refundOf ?? null}::uuid, ${entry.note ?? null})
               ON CONFLICT (refund_of) DO NOTHING
               RETURNING id`
  );
  return rows[0]?.id ?? null;
}

async function charge(input: ChargeInput): Promise<ChargeResult> {
  return withTransaction(async (tx) => {
    const rate = await findRate(input.action, tx);
    const cost = input.exempt || !rate ? 0 : rate.credits;
    const balance = await lockWallet(tx, input.companyId);

    if (cents(cost) > 0) {
      if (cents(balance) < cents(cost)) return { ok: false, scope: 'company', available: balance, required: cost };
      const limit = await creditLimit(tx, input.userId);
      if (limit !== null) {
        const used = await totalUse(tx, input.companyId, input.userId);
        if (cents(used) + cents(cost) > cents(limit)) {
          return { ok: false, scope: 'user', available: Math.max(0, limit - used), required: cost };
        }
      }
    }

    const after = cents(cost) > 0 ? await moveBalance(tx, input.companyId, -cost) : balance;
    const id = await insertEntry(tx, {
      companyId: input.companyId,
      kind: 'usage',
      credits: -cost,
      balanceAfter: after,
      userId: input.userId,
      action: input.action,
      contextId: input.contextId,
      sessionId: input.sessionId,
      note: input.exempt ? 'Platform support' : null,
    });
    return { ok: true, id: id as string, credits: cost, balance: after };
  });
}

async function refund(entryId: string, userId: string): Promise<RefundResult> {
  return withTransaction(async (tx) => {
    const rows = await rawRows<{
      company_id: string;
      credits: number;
      action: string | null;
      context_id: string | null;
      session_id: string | null;
    }>(
      tx,
      Prisma.sql`SELECT company_id, credits, action, context_id, session_id FROM company_credit_ledger
                  WHERE id = ${entryId}::uuid AND kind = 'usage' AND user_id = ${userId}::uuid
                    AND created_at >= now() - make_interval(mins => ${REFUND_WINDOW_MINUTES}::int)`
    );
    const entry = rows[0];
    if (!entry || cents(entry.credits) >= 0) return { refunded: false, credits: 0 };

    const amount = -entry.credits;
    const balance = await lockWallet(tx, entry.company_id);
    const id = await insertEntry(tx, {
      companyId: entry.company_id,
      kind: 'refund',
      credits: amount,
      balanceAfter: (cents(balance) + cents(amount)) / 100,
      userId,
      action: entry.action,
      contextId: entry.context_id,
      sessionId: entry.session_id,
      refundOf: entryId,
      note: 'The agent service did not run the request',
    });
    if (!id) return { refunded: false, credits: 0 };
    await moveBalance(tx, entry.company_id, amount);
    return { refunded: true, credits: amount };
  });
}

async function allocate(
  companyId: string,
  credits: number,
  actorId: string,
  note: string | null
): Promise<AllocationResult> {
  return withTransaction(async (tx) => {
    const balance = await lockWallet(tx, companyId);
    if (cents(balance) + cents(credits) < 0) return { ok: false, id: null, balance };
    const after = await moveBalance(tx, companyId, credits);
    const id = await insertEntry(tx, {
      companyId,
      kind: 'allocation',
      credits,
      balanceAfter: after,
      userId: actorId,
      note,
    });
    return { ok: true, id, balance: after };
  });
}

async function companyExists(companyId: string): Promise<boolean> {
  const company = await prisma.company.findFirst({ where: { id: companyId, deletedAt: null }, select: { id: true } });
  return company !== null;
}

async function balanceOf(companyId: string): Promise<number> {
  const rows = await rawRows<{ balance: number }>(
    prisma,
    Prisma.sql`SELECT balance FROM company_credits WHERE company_id = ${companyId}::uuid`
  );
  return rows[0]?.balance ?? 0;
}

async function memberStatus(companyId: string, userId: string): Promise<{ limit: number | null; used: number }> {
  const [limit, used] = await Promise.all([creditLimit(prisma, userId), totalUse(prisma, companyId, userId)]);
  return { limit, used };
}

async function listMembers(companyId: string): Promise<MemberRow[]> {
  return rawRows<MemberRow>(
    prisma,
    Prisma.sql`SELECT u.id, u.username, u.email, u.display_name, r.tier::text AS role, u.status::text AS status,
                      l.credit_limit, COALESCE(m.used, 0) AS used
                 FROM users u
                 LEFT JOIN access_control.user_roles ur ON ur.user_id = u.id
                 LEFT JOIN access_control.roles r ON r.id = ur.role_id
                 LEFT JOIN user_credit_limits l ON l.user_id = u.id
                 LEFT JOIN (SELECT user_id, -SUM(credits) AS used FROM company_credit_ledger
                             WHERE company_id = ${companyId}::uuid AND kind IN ('usage', 'refund')
                             GROUP BY user_id) m ON m.user_id = u.id
                WHERE u.company_id = ${companyId}::uuid AND u.deleted_at IS NULL
                ORDER BY COALESCE(m.used, 0) DESC, lower(COALESCE(u.display_name, u.username)), u.id`
  );
}

async function findMember(userId: string): Promise<{ id: string; company_id: string | null; name: string } | null> {
  const rows = await rawRows<{ id: string; company_id: string | null; name: string }>(
    prisma,
    Prisma.sql`SELECT id, company_id, COALESCE(display_name, username) AS name FROM users
                WHERE id = ${userId}::uuid AND deleted_at IS NULL`
  );
  return rows[0] || null;
}

async function setLimit(userId: string, limit: number | null, updatedBy: string): Promise<void> {
  if (limit === null) {
    await prisma.userCreditLimit.deleteMany({ where: { userId } });
    return;
  }
  await prisma.userCreditLimit.upsert({
    where: { userId },
    create: { userId, creditLimit: limit, updatedBy },
    update: { creditLimit: limit, updatedBy, updatedAt: new Date() },
  });
}

async function companyTotals(companyId: string): Promise<CompanyTotals> {
  const rows = await rawRows<CompanyTotals>(
    prisma,
    Prisma.sql`SELECT COALESCE((SELECT balance FROM company_credits WHERE company_id = ${companyId}::uuid), 0) AS balance,
                      COALESCE(SUM(credits) FILTER (WHERE kind = 'allocation'), 0) AS allocated,
                      COALESCE(-SUM(credits) FILTER (WHERE kind IN ('usage', 'refund')), 0) AS used,
                      COALESCE(-SUM(credits) FILTER (WHERE kind IN ('usage', 'refund') AND created_at >= now() - interval '30 days'), 0) AS used_30_days,
                      COUNT(*) FILTER (WHERE kind = 'usage') - COUNT(*) FILTER (WHERE kind = 'refund') AS runs
                 FROM company_credit_ledger WHERE company_id = ${companyId}::uuid`
  );
  return rows[0];
}

async function usageByAction(companyId: string): Promise<UsageByAction[]> {
  return rawRows<UsageByAction>(
    prisma,
    Prisma.sql`SELECT e.action, r.label, -SUM(e.credits) AS credits,
                      COUNT(*) FILTER (WHERE e.kind = 'usage') - COUNT(*) FILTER (WHERE e.kind = 'refund') AS runs
                 FROM company_credit_ledger e
                 LEFT JOIN credit_rates r ON r.action = e.action
                WHERE e.company_id = ${companyId}::uuid AND e.kind IN ('usage', 'refund')
                  AND e.action IS NOT NULL
                GROUP BY e.action, r.label, r.sort_order
                ORDER BY r.sort_order NULLS LAST, e.action`
  );
}

async function usageByDay(companyId: string, days: number): Promise<UsageByDay[]> {
  const today = new Date();
  const since = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (days - 1)));
  return rawRows<UsageByDay>(
    prisma,
    Prisma.sql`SELECT to_char((e.created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day, e.action,
                      -SUM(e.credits) AS credits
                 FROM company_credit_ledger e
                WHERE e.company_id = ${companyId}::uuid AND e.kind IN ('usage', 'refund') AND e.action IS NOT NULL
                  AND e.created_at >= ${since.toISOString()}::timestamptz
                GROUP BY 1, e.action
               HAVING SUM(e.credits) <> 0
                ORDER BY 1, e.action`
  );
}

function ledgerWhere(filter: LedgerFilter): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`e.company_id = ${filter.companyId}::uuid`];
  if (filter.userId) conditions.push(Prisma.sql`e.user_id = ${filter.userId}::uuid`);
  if (filter.kind) conditions.push(Prisma.sql`e.kind = ${filter.kind}::credit_entry_kind`);
  if (filter.action) conditions.push(Prisma.sql`e.action = ${filter.action}`);
  if (filter.search) {
    const pattern = likePattern(filter.search);
    conditions.push(
      Prisma.sql`(u.username ILIKE ${pattern} OR u.display_name ILIKE ${pattern} OR u.email ILIKE ${pattern}
        OR cn.name ILIKE ${pattern} OR e.note ILIKE ${pattern} OR r.label ILIKE ${pattern})`
    );
  }
  return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
}

const LEDGER_FROM = Prisma.sql`FROM company_credit_ledger e
       LEFT JOIN users u ON u.id = e.user_id
       LEFT JOIN connections cn ON cn.id = e.context_id
       LEFT JOIN credit_rates r ON r.action = e.action`;

async function listLedger<R>(filter: LedgerFilter, list: ListWindow, shape: (row: LedgerRow) => R) {
  const where = ledgerWhere(filter);
  return pagedRows(
    prisma,
    Prisma.sql`SELECT e.id, e.kind::text AS kind, e.credits, e.balance_after, e.user_id,
                      COALESCE(u.display_name, u.username) AS user_name, u.email AS user_email,
                      u.company_id AS user_company_id, e.action, r.label AS action_label,
                      e.context_id, cn.name AS context_name, e.session_id, e.note,
                      EXISTS (SELECT 1 FROM company_credit_ledger x WHERE x.refund_of = e.id) AS refunded,
                      e.created_at, COUNT(*) OVER () AS "__total"
                 ${LEDGER_FROM} ${where}
                 ${Prisma.raw(orderBy(list, LEDGER_SORTS, 'e.created_at DESC, e.id'))}
                LIMIT ${list.pageSize} OFFSET ${list.offset}`,
    Prisma.sql`SELECT COUNT(*) AS n ${LEDGER_FROM} ${where}`,
    shape
  );
}

function companyWhere(search: string): Prisma.Sql {
  if (!search) return Prisma.sql`WHERE c.deleted_at IS NULL`;
  const pattern = likePattern(search);
  return Prisma.sql`WHERE c.deleted_at IS NULL AND (c.name ILIKE ${pattern} OR c.slug ILIKE ${pattern})`;
}

function companyFrom(): Prisma.Sql {
  return Prisma.sql`FROM companies c
       LEFT JOIN company_credits w ON w.company_id = c.id
       LEFT JOIN (SELECT company_id,
                         SUM(credits) FILTER (WHERE kind = 'allocation') AS allocated,
                         -SUM(credits) FILTER (WHERE kind IN ('usage', 'refund')) AS used,
                         MAX(created_at) FILTER (WHERE kind = 'usage') AS last_used_at
                    FROM company_credit_ledger GROUP BY company_id) s ON s.company_id = c.id`;
}

async function listCompanies<R>(search: string, list: ListWindow, shape: (row: CompanyCreditRow) => R) {
  const where = companyWhere(search);
  return pagedRows(
    prisma,
    Prisma.sql`SELECT * FROM (
                 SELECT c.id, c.name, c.slug, c.active, COALESCE(w.balance, 0) AS balance,
                        COALESCE(s.allocated, 0) AS allocated, COALESCE(s.used, 0) AS used, s.last_used_at,
                        COUNT(*) OVER () AS "__total"
                   ${companyFrom()} ${where}) c
                 ${Prisma.raw(orderBy(list, COMPANY_SORTS, 'c.id'))}
                LIMIT ${list.pageSize} OFFSET ${list.offset}`,
    Prisma.sql`SELECT COUNT(*) AS n FROM companies c ${where}`,
    shape
  );
}

async function platformTotals(): Promise<{ balance: number; allocated: number; used: number; companies: number }> {
  const rows = await rawRows<{ balance: number; allocated: number; used: number; companies: number }>(
    prisma,
    Prisma.sql`SELECT COALESCE(SUM(w.balance), 0) AS balance, COALESCE(SUM(s.allocated), 0) AS allocated,
                      COALESCE(SUM(s.used), 0) AS used, COUNT(*) FILTER (WHERE COALESCE(s.allocated, 0) > 0) AS companies
                 ${companyFrom()} WHERE c.deleted_at IS NULL`
  );
  return rows[0];
}

export {
  COMPANY_SORTS,
  LEDGER_SORTS,
  listRates,
  findRate,
  updateRate,
  charge,
  refund,
  allocate,
  companyExists,
  balanceOf,
  memberStatus,
  listMembers,
  findMember,
  setLimit,
  companyTotals,
  usageByAction,
  usageByDay,
  listLedger,
  listCompanies,
  platformTotals,
};
export type {
  RateRow,
  ChargeInput,
  ChargeResult,
  RefundResult,
  MemberRow,
  CompanyCreditRow,
  LedgerRow,
  LedgerFilter,
  UsageByAction,
  UsageByDay,
};
