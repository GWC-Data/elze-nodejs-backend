import type { CompanyCreditRow, LedgerRow, MemberRow, RateRow } from './creditRepository';

interface CreditRate {
  action: string;
  label: string;
  description: string | null;
  credits: number;
  updatedAt: Date;
}

interface CreditMember {
  id: string;
  name: string;
  username: string;
  email: string;
  role: string | null;
  status: string;
  limit: number | null;
  used: number;
  remaining: number | null;
}

interface CompanyCredits {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  balance: number;
  allocated: number;
  used: number;
  lastUsedAt: Date | null;
}

interface CreditEntry {
  id: string;
  kind: string;
  credits: number;
  balanceAfter: number;
  user: { id: string | null; name: string; email: string | null; platform: boolean } | null;
  action: { key: string; label: string } | null;
  context: { id: string; name: string | null } | null;
  sessionId: string | null;
  note: string | null;
  refunded: boolean;
  createdAt: Date;
}

const PLATFORM_TEAM = 'Elze platform team';

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function shapeRate(row: RateRow): CreditRate {
  return {
    action: row.action,
    label: row.label,
    description: row.description ?? null,
    credits: round(row.credits),
    updatedAt: row.updated_at,
  };
}

function shapeMember(row: MemberRow): CreditMember {
  const limit = row.credit_limit === null ? null : round(row.credit_limit);
  const used = round(row.used);
  return {
    id: row.id,
    name: row.display_name || row.username,
    username: row.username,
    email: row.email,
    role: row.role,
    status: row.status,
    limit,
    used,
    remaining: limit === null ? null : round(Math.max(0, limit - used)),
  };
}

function shapeCompany(row: CompanyCreditRow): CompanyCredits {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    active: row.active,
    balance: round(row.balance),
    allocated: round(row.allocated),
    used: round(row.used),
    lastUsedAt: row.last_used_at ?? null,
  };
}

function userOf(row: LedgerRow, viewerIsPlatform: boolean): CreditEntry['user'] {
  const team = { id: null, name: PLATFORM_TEAM, email: null, platform: true };
  if (!row.user_id) return row.kind === 'allocation' ? team : null;
  const platform = row.user_company_id === null;
  if (platform && !viewerIsPlatform) return team;
  return { id: row.user_id, name: row.user_name ?? 'A removed account', email: row.user_email ?? null, platform };
}

function entryShaper(viewerIsPlatform: boolean): (row: LedgerRow) => CreditEntry {
  return (row) => ({
    id: row.id,
    kind: row.kind,
    credits: round(row.credits),
    balanceAfter: round(row.balance_after),
    user: userOf(row, viewerIsPlatform),
    action: row.action ? { key: row.action, label: row.action_label ?? row.action } : null,
    context: row.context_id ? { id: row.context_id, name: row.context_name ?? null } : null,
    sessionId: row.session_id ?? null,
    note: row.note ?? null,
    refunded: Boolean(row.refunded),
    createdAt: row.created_at,
  });
}

export { round, shapeRate, shapeMember, shapeCompany, entryShaper };
export type { CreditRate, CreditMember, CompanyCredits, CreditEntry };
