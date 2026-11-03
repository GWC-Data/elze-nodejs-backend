import crypto from 'node:crypto';
import * as creditRepository from './creditRepository';
import { audit, EVENTS } from '../audit/auditService';
import { assertCompanyMatch, resolveTargetCompany } from '../auth/authorizationService';
import { fail } from '../../shared/errors/AppError';
import { hashToken } from '../../shared/security/hash';
import { bodyOf, isUuid, requireUuid } from '../../shared/validation/commonValidator';
import { entryShaper, round, shapeCompany, shapeMember, shapeRate } from './creditSerializer';
import type { Actor } from '../../shared/types/actor';
import type { ListQuery } from '../../shared/validation/listValidator';

const MAX_CREDITS = 1_000_000;
const MAX_RATE = 1_000;
const USAGE_DAYS = 30;
const NOTE_LENGTH = 255;
const ENTRY_KINDS = ['allocation', 'usage', 'refund'] as const;

const COMPANY_SORTS = creditRepository.COMPANY_SORTS;
const LEDGER_SORTS = creditRepository.LEDGER_SORTS;

interface AgentRequest {
  contextId: string;
  companyId: string | null;
  path: string;
  method: string;
}

interface CreditStatus {
  companyId: string | null;
  balance: number | null;
  limit: number | null;
  used: number;
  remaining: number | null;
  available: number | null;
  exempt: boolean;
}

const BILLABLE: { method: string; match: RegExp; action: string }[] = [
  { method: 'POST', match: /^\/context-layer\/sessions\/([^/]+)\/messages\/?$/, action: 'context.build' },
  { method: 'POST', match: /^\/description-editor\/sessions\/([^/]+)\/messages\/?$/, action: 'context.chat' },
  { method: 'POST', match: /^\/data-analyst\/sessions\/([^/]+)\/messages\/?$/, action: 'analyst.question' },
];

function billableAction(method: string, path: string): { action: string; sessionId: string } | null {
  for (const rule of BILLABLE) {
    if (rule.method !== method) continue;
    const m = rule.match.exec(path);
    if (m) return { action: rule.action, sessionId: m[1].slice(0, 128) };
  }
  return null;
}

function amount(value: number): string {
  return round(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function requireCredits(
  value: unknown,
  label: string,
  { min, max, allowZero }: { min: number; max: number; allowZero: boolean }
): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) throw fail('VALIDATION_ERROR', `${label} must be a number.`);
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) {
    throw fail('VALIDATION_ERROR', `${label} can have at most two decimal places.`);
  }
  if (n < min || n > max) throw fail('VALIDATION_ERROR', `${label} must be from ${amount(min)} to ${amount(max)}.`);
  if (!allowZero && n === 0) throw fail('VALIDATION_ERROR', `${label} must not be zero.`);
  return round(n);
}

function optionalNote(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw fail('VALIDATION_ERROR', 'note must be text.');
  const note = value.trim();
  if (note.length > NOTE_LENGTH) throw fail('VALIDATION_ERROR', `note must be ${NOTE_LENGTH} characters or fewer.`);
  return note || null;
}

function signature(id: string): string {
  return hashToken(`credit-refund:${id}`);
}

function refundToken(id: string): string {
  return `${id}.${signature(id)}`;
}

function refundEntryId(token: unknown): string {
  const [id, given] = typeof token === 'string' ? token.split('.') : [];
  if (!isUuid(id) || !given) throw fail('VALIDATION_ERROR', 'token is not a charge token.');
  const expected = Buffer.from(signature(id));
  const received = Buffer.from(given);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    throw fail('VALIDATION_ERROR', 'token is not a charge token.');
  }
  return id;
}

async function chargeAgentRequest(actor: Actor, request: AgentRequest): Promise<string | null> {
  const billable = billableAction(request.method, request.path);
  if (!billable || !request.companyId) return null;

  const result = await creditRepository.charge({
    companyId: request.companyId,
    userId: actor.id,
    action: billable.action,
    contextId: request.contextId,
    sessionId: billable.sessionId,
    exempt: actor.isPlatform,
  });
  if (!result.ok) {
    const detail = { available: round(result.available), required: round(result.required) };
    if (result.scope === 'company') {
      throw fail(
        'INSUFFICIENT_CREDITS',
        `Your company has ${amount(result.available)} credits left and this needs ${amount(result.required)}.`,
        detail
      );
    }
    throw fail(
      'CREDIT_LIMIT_REACHED',
      `You have ${amount(result.available)} credits left under your limit and this needs ${amount(result.required)}.`,
      detail
    );
  }
  return result.credits > 0 ? refundToken(result.id) : null;
}

async function refundAgentCharge(actor: Actor, body: unknown) {
  const id = refundEntryId(bodyOf(body).token);
  const result = await creditRepository.refund(id, actor.id);
  return { refunded: result.refunded, credits: round(result.credits) };
}

async function myCredits(actor: Actor, companyId?: unknown): Promise<CreditStatus> {
  if (actor.isPlatform) {
    const target = companyId === undefined || companyId === '' ? null : requireUuid(companyId, 'companyId');
    const balance = target ? round(await creditRepository.balanceOf(target)) : null;
    return {
      companyId: target,
      balance,
      limit: null,
      used: 0,
      remaining: null,
      available: balance,
      exempt: true,
    };
  }

  const company = actor.companyId as string;
  const [balance, member] = await Promise.all([
    creditRepository.balanceOf(company),
    creditRepository.memberStatus(company, actor.id),
  ]);
  const remaining = member.limit === null ? null : Math.max(0, member.limit - member.used);
  return {
    companyId: company,
    balance: round(balance),
    limit: member.limit === null ? null : round(member.limit),
    used: round(member.used),
    remaining: remaining === null ? null : round(remaining),
    available: round(remaining === null ? balance : Math.min(balance, remaining)),
    exempt: false,
  };
}

async function listRates() {
  return (await creditRepository.listRates()).map(shapeRate);
}

async function updateRate(actor: Actor, action: unknown, body: unknown) {
  const key = String(action ?? '');
  const previous = await creditRepository.findRate(key);
  if (!previous) throw fail('RESOURCE_NOT_FOUND', 'There is no price for that action.');
  const credits = requireCredits(bodyOf(body).credits, 'credits', { min: 0, max: MAX_RATE, allowZero: true });
  const row = await creditRepository.updateRate(key, credits, actor.id);
  if (!row) throw fail('RESOURCE_NOT_FOUND', 'There is no price for that action.');
  audit(EVENTS.CREDIT_RATE_UPDATED, actor, { action: key, credits, previous: round(previous.credits) });
  return shapeRate(row);
}

async function requireCompany(actor: Actor, companyId: unknown): Promise<string> {
  const company = resolveTargetCompany(actor, companyId);
  if (actor.isPlatform && !(await creditRepository.companyExists(company))) {
    throw fail('RESOURCE_NOT_FOUND', 'That company was not found.');
  }
  return company;
}

async function listCompanies(list: ListQuery) {
  const [page, totals] = await Promise.all([
    creditRepository.listCompanies(list.search, list, shapeCompany),
    creditRepository.platformTotals(),
  ]);
  return {
    ...page,
    totals: {
      balance: round(totals.balance),
      allocated: round(totals.allocated),
      used: round(totals.used),
      companies: totals.companies,
    },
  };
}

async function allocate(actor: Actor, companyId: unknown, body: unknown) {
  const company = requireUuid(companyId, 'companyId');
  if (!(await creditRepository.companyExists(company))) throw fail('RESOURCE_NOT_FOUND', 'That company was not found.');
  const input = bodyOf(body);
  const credits = requireCredits(input.credits, 'credits', { min: -MAX_CREDITS, max: MAX_CREDITS, allowZero: false });
  const note = optionalNote(input.note);

  const result = await creditRepository.allocate(company, credits, actor.id, note);
  if (!result.ok) {
    throw fail(
      'VALIDATION_ERROR',
      `The company has ${amount(result.balance)} credits, so no more than that can be taken back.`
    );
  }
  audit(EVENTS.CREDITS_ALLOCATED, actor, { companyId: company, credits, balance: round(result.balance), note });
  return { companyId: company, credits, balance: round(result.balance), entryId: result.id };
}

function lastDays(days: number): string[] {
  const today = new Date();
  return Array.from({ length: days }, (_, i) =>
    new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (days - 1 - i)))
      .toISOString()
      .slice(0, 10)
  );
}

async function overview(actor: Actor, companyId: unknown) {
  const company = await requireCompany(actor, companyId);
  const [totals, byAction, byDay, rates] = await Promise.all([
    creditRepository.companyTotals(company),
    creditRepository.usageByAction(company),
    creditRepository.usageByDay(company, USAGE_DAYS),
    creditRepository.listRates(),
  ]);
  return {
    companyId: company,
    balance: round(totals.balance),
    allocated: round(totals.allocated),
    used: round(totals.used),
    used30Days: round(totals.used_30_days),
    runs: totals.runs,
    byAction: byAction.map((row) => ({
      action: row.action,
      label: row.label ?? row.action,
      credits: round(row.credits),
      runs: row.runs,
    })),
    daily: {
      days: lastDays(USAGE_DAYS),
      actions: rates.map((rate) => ({ action: rate.action, label: rate.label })),
      usage: byDay.map((row) => ({ day: row.day, action: row.action, credits: round(row.credits) })),
    },
  };
}

async function members(actor: Actor, companyId: unknown) {
  const company = await requireCompany(actor, companyId);
  const rows = await creditRepository.listMembers(company);
  return { items: rows.map(shapeMember) };
}

async function setLimit(actor: Actor, userId: unknown, body: unknown) {
  const target = await creditRepository.findMember(requireUuid(userId, 'userId'));
  if (!target?.company_id) throw fail('RESOURCE_NOT_FOUND', 'That member was not found.');
  assertCompanyMatch(actor, target.company_id, 'That account');

  const value = bodyOf(body).limit;
  if (value === undefined) {
    throw fail('VALIDATION_ERROR', 'limit is required: a number of credits, or null to remove the restriction.');
  }
  const limit = value === null ? null : requireCredits(value, 'limit', { min: 0, max: MAX_CREDITS, allowZero: true });

  await creditRepository.setLimit(target.id, limit, actor.id);
  audit(EVENTS.CREDIT_LIMIT_UPDATED, actor, {
    companyId: target.company_id,
    userId: target.id,
    name: target.name,
    limit,
  });
  const status = await creditRepository.memberStatus(target.company_id, target.id);
  return {
    userId: target.id,
    limit,
    used: round(status.used),
    remaining: limit === null ? null : round(Math.max(0, limit - status.used)),
  };
}

async function activity(
  actor: Actor,
  list: ListQuery,
  filters: { companyId?: unknown; userId?: unknown; kind?: unknown; action?: unknown }
) {
  const company = await requireCompany(actor, filters.companyId);
  const kind = filters.kind === undefined || filters.kind === '' ? undefined : String(filters.kind);
  if (kind && !(ENTRY_KINDS as readonly string[]).includes(kind)) {
    throw fail('VALIDATION_ERROR', `kind must be one of: ${ENTRY_KINDS.join(', ')}.`);
  }
  const action =
    filters.action === undefined || filters.action === '' ? undefined : String(filters.action).slice(0, 40);
  const userId =
    filters.userId === undefined || filters.userId === '' ? undefined : requireUuid(filters.userId, 'userId');
  return creditRepository.listLedger(
    { companyId: company, userId, kind, action, search: list.search },
    list,
    entryShaper(actor.isPlatform)
  );
}

export {
  COMPANY_SORTS,
  LEDGER_SORTS,
  billableAction,
  chargeAgentRequest,
  refundAgentCharge,
  myCredits,
  listRates,
  updateRate,
  listCompanies,
  allocate,
  overview,
  members,
  setLimit,
  activity,
};
export type { AgentRequest, CreditStatus };
