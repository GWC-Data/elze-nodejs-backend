import * as auditRepository from '../repositories/audit.repository';
import { EVENTS, FORBIDDEN_DETAIL_KEYS, AUDIT_CATEGORIES, AUDIT_ACTIONS } from '../constants/auditEvents';
import { fail } from '../tools/AppError';
import { COMPANY_ADMIN } from '../constants/permissions';
import { shapeEntry } from '../views/serializers/audit.serializer';
import { FEATURE_OF_PERMISSION, usableFeatures } from '../constants/features';
import type { AuditScope } from '../repositories/audit.repository';
import type { Actor } from '../types/actor';

type AuditActor = Actor | Record<string, any> | string | null | undefined;
type AuditDetail = Record<string, unknown>;
type AuditItem = Record<string, any>;

interface AuditListQuery {
  search: string;
  sort: string;
  dir: string;
  offset: number;
  pageSize: number;
}

const KNOWN_EVENTS = new Set<string>(Object.values(EVENTS));

function scrub(detail: AuditDetail | null | undefined): AuditDetail {
  const safe: AuditDetail = {};
  for (const [key, value] of Object.entries(detail || {})) {
    if (FORBIDDEN_DETAIL_KEYS.has(key)) {
      safe[key] = '[redacted]';
      console.warn(`[audit] refused to record "${key}" - credentials are never written to the trail`);
      continue;
    }
    if (value !== undefined) safe[key] = value;
  }
  return safe;
}

function idOrNull(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Fire-and-forget: a failed write is logged, never surfaced, so auditing can't break the
// action it records. The console line stays as the fallback trail.
function audit(event: string, actor: AuditActor, detail: AuditDetail = {}): void {
  if (!KNOWN_EVENTS.has(event)) {
    console.warn(`[audit] unknown event "${event}" - add it to EVENTS in constants/auditEvents.ts`);
  }
  try {
    const who = actor && typeof actor === 'object'
      ? { actorId: actor.id ?? null, actor: actor.username ?? null, actorCompanyId: actor.companyId ?? null }
      : { actorId: null, actor: String(actor || 'anonymous'), actorCompanyId: null };

    const safe = scrub(detail);
    console.log(`[audit] ${JSON.stringify({ ts: new Date().toISOString(), event, ...safe, ...who })}`);

    auditRepository
      .append({
        event,
        actorId: idOrNull(who.actorId),
        actor: who.actor === null ? null : String(who.actor),
        actorCompanyId: idOrNull(who.actorCompanyId),
        companyId: idOrNull(safe.companyId) ?? idOrNull(who.actorCompanyId),
        targetUserId: idOrNull(safe.userId),
        detail: safe,
      })
      .catch((err: any) => console.error('[audit] write failed:', err.message));
  } catch (err: any) {
    console.error('[audit] write failed:', err.message);
  }
}

// The platform owner reads everything, a company admin their company's trail, and anyone
// else the events they performed or that were performed on their account.
function scopeFor(actor: Actor): AuditScope {
  if (actor.isPlatform) return { kind: 'all' };
  if (actor.role === COMPANY_ADMIN && actor.companyId) {
    return { kind: 'company', companyId: actor.companyId };
  }
  return { kind: 'self', userId: actor.id };
}

function describeScope(actor: Actor): 'all' | 'company' | 'self' {
  return scopeFor(actor).kind;
}

interface AuditFilters {
  event?: string | null;
  category?: string | null;
  action?: string | null;
  from?: string | null;
  to?: string | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function day(value: string | null | undefined, name: string): string | null {
  if (!value) return null;
  if (!DAY.test(value) || Number.isNaN(Date.parse(value))) {
    throw fail('VALIDATION_ERROR', `"${name}" must be a date written YYYY-MM-DD.`);
  }
  return value;
}

// Feature lists inside an entry (company_created's `features`, company_features_updated's
// `enabled`/`disabled`) are cut down to what the reader can use: a company account's responses
// never name a feature it does not have. The platform owner sees them whole.
const FEATURE_DETAIL_KEYS = ['features', 'enabled', 'disabled'];

function visibleDetail(detail: Record<string, unknown>, visible: Set<string> | null): Record<string, unknown> {
  if (!visible) return detail;
  const out: Record<string, unknown> = { ...detail };
  for (const key of FEATURE_DETAIL_KEYS) {
    const value = out[key];
    if (!Array.isArray(value)) continue;
    const kept = value.filter((id) => visible.has(String(id)));
    if (kept.length) out[key] = kept;
    else delete out[key];
  }
  // A refused permission of a feature the reader lacks would name that feature too.
  const permission = typeof out.permission === 'string' ? out.permission : null;
  const owner = permission ? FEATURE_OF_PERMISSION.get(permission) : undefined;
  if (owner && !visible.has(owner)) delete out.permission;
  return out;
}

async function listEntries(
  actor: Actor,
  list: AuditListQuery,
  filters: AuditFilters = {}
): Promise<{ items: AuditItem[]; total: number; scope: string }> {
  const scope = scopeFor(actor);
  const { event, category, action } = filters;
  let eventPrefixes: string[] | null = null;
  if (category) {
    eventPrefixes = AUDIT_CATEGORIES[category] ?? null;
    if (!eventPrefixes) {
      throw fail('VALIDATION_ERROR', `Unknown category "${category}". Use one of: ${Object.keys(AUDIT_CATEGORIES).join(', ')}.`);
    }
  }
  let eventSuffixes: string[] | null = null;
  if (action) {
    eventSuffixes = AUDIT_ACTIONS[action] ?? null;
    if (!eventSuffixes) {
      throw fail('VALIDATION_ERROR', `Unknown action "${action}". Use one of: ${Object.keys(AUDIT_ACTIONS).join(', ')}.`);
    }
  }
  const from = day(filters.from, 'from');
  const to = day(filters.to, 'to');
  if (from && to && from > to) throw fail('VALIDATION_ERROR', '"from" must not be after "to".');

  const visible = actor.isPlatform ? null : new Set(usableFeatures(actor.features, actor.permissions));
  const page = await auditRepository.listPage(
    { scope, event, eventPrefixes, eventSuffixes, from, to, search: list.search },
    list,
    (row) => shapeEntry({
      ts: row.ts instanceof Date ? row.ts.toISOString() : row.ts,
      event: row.event,
      ...visibleDetail(row.detail || {}, visible),
      actor: row.actor,
      actorId: row.actor_id,
      actorCompanyId: row.actor_company_id,
    }, { id: row.id, companyId: row.company_id, companyName: row.company_name })
  );
  return { ...page, scope: scope.kind };
}

function denied(actor: AuditActor, detail?: AuditDetail): void {
  audit(EVENTS.ACCESS_DENIED, actor, detail);
}

export { audit, EVENTS, listEntries, describeScope, denied };
export type { AuditActor, AuditDetail, AuditListQuery, AuditFilters };
