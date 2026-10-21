import * as auditRepository from './auditRepository';
import { EVENTS, FORBIDDEN_DETAIL_KEYS } from './auditEvents';
import { fail, messageOf } from '../../shared/errors/AppError';
import { COMPANY_ADMIN } from '../catalogue/roleTiers';
import { seesPlatformAccounts } from '../auth/authorizationService';
import { shapeEntry } from './auditSerializer';
import {
  auditActions,
  auditCategories,
  auditEventsInCategory,
  auditEventsWithAction,
  featureById,
  featureKeys,
  featureOfPermission,
  hiddenAuditEvents,
  isHiddenAuditCategory,
  isHiddenFeature,
  isHiddenPermission,
  usableFeatures,
  visibleFeatureKeys,
} from '../catalogue/catalogueService';
import type { AuditScope } from './auditRepository';
import type { AuditItem } from './auditSerializer';
import type { Prisma } from '../../generated/prisma/client';
import type { Actor } from '../../shared/types/actor';

interface AuditPrincipal {
  id?: unknown;
  username?: unknown;
  companyId?: unknown;
}

type AuditActor = AuditPrincipal | string | null | undefined;
type AuditDetail = Record<string, unknown>;

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

function audit(event: string, actor: AuditActor, detail: AuditDetail = {}): void {
  if (!KNOWN_EVENTS.has(event)) {
    console.warn(`[audit] unknown event "${event}" - add it to EVENTS in constants/auditEvents.ts`);
  }
  try {
    const who =
      actor && typeof actor === 'object'
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
      .catch((err: unknown) => console.error('[audit] write failed:', messageOf(err)));
  } catch (err) {
    console.error('[audit] write failed:', messageOf(err));
  }
}

function scopeFor(actor: Actor): AuditScope {
  if (actor.isPlatform) {
    return seesPlatformAccounts(actor) ? { kind: 'all' } : { kind: 'all', hidePlatformTargetsExcept: actor.id };
  }
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

const FEATURE_DETAIL_KEYS = ['features', 'enabled', 'disabled'];
const FEATURE_ID_DETAIL_KEYS = ['featureIds', 'enabledIds', 'disabledIds'];
const PERMISSION_DETAIL_KEYS = ['added', 'removed'];

function detailOf(value: Prisma.JsonValue): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function visibleDetail(detail: Record<string, unknown>, visible: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...detail };
  for (const key of PERMISSION_DETAIL_KEYS) {
    const value = out[key];
    if (!Array.isArray(value)) continue;
    const kept = value.filter((p) => {
      const owner = featureOfPermission(String(p));
      return !isHiddenPermission(String(p)) && (!owner || visible.has(owner));
    });
    if (kept.length) out[key] = kept;
    else delete out[key];
  }
  for (const key of FEATURE_DETAIL_KEYS) {
    const value = out[key];
    if (!Array.isArray(value)) continue;
    const kept = value.filter((id) => visible.has(String(id)));
    if (kept.length) out[key] = kept;
    else delete out[key];
  }
  for (const key of FEATURE_ID_DETAIL_KEYS) {
    const value = out[key];
    if (!Array.isArray(value)) continue;
    const kept = value.filter((id) => visible.has(featureById(String(id))?.key || ''));
    if (kept.length) out[key] = kept;
    else delete out[key];
  }
  const permission = typeof out.permission === 'string' ? out.permission : null;
  const owner = permission ? featureOfPermission(permission) : undefined;
  if (owner && !visible.has(owner)) {
    delete out.permission;
    delete out.permissionId;
  }
  return out;
}

async function listEntries(
  actor: Actor,
  list: AuditListQuery,
  filters: AuditFilters = {}
): Promise<{ items: AuditItem[]; total: number; scope: string }> {
  const scope = scopeFor(actor);
  const { event, category, action } = filters;
  let categoryEvents: string[] | null = null;
  if (category) {
    categoryEvents = auditEventsInCategory(category);
    if (!categoryEvents) {
      const shown = auditCategories().filter((c) => !isHiddenAuditCategory(c));
      throw fail('VALIDATION_ERROR', `Unknown category "${category}". Use one of: ${shown.join(', ')}.`);
    }
    if (isHiddenAuditCategory(category)) categoryEvents = [];
  }
  let actionEvents: string[] | null = null;
  if (action) {
    actionEvents = auditEventsWithAction(action);
    if (!actionEvents) {
      throw fail('VALIDATION_ERROR', `Unknown action "${action}". Use one of: ${auditActions().join(', ')}.`);
    }
  }
  const from = day(filters.from, 'from');
  const to = day(filters.to, 'to');
  if (from && to && from > to) throw fail('VALIDATION_ERROR', '"from" must not be after "to".');

  const visible = new Set(
    visibleFeatureKeys(actor.isPlatform ? featureKeys() : usableFeatures(actor.features, actor.permissions))
  );
  const hiddenEvents = hiddenAuditEvents().filter((e) => e !== EVENTS.ACCESS_DENIED);
  const page = await auditRepository.listPage(
    {
      scope,
      event,
      categoryEvents,
      actionEvents,
      hiddenEvents,
      hideDashboardDenials: isHiddenFeature('dashboards'),
      from,
      to,
      search: list.search,
    },
    list,
    (row) =>
      shapeEntry(
        {
          ts: row.ts instanceof Date ? row.ts.toISOString() : row.ts,
          event: row.event,
          ...visibleDetail(detailOf(row.detail), visible),
          actor: row.actor,
          actorId: row.actor_id,
          actorCompanyId: row.actor_company_id,
        },
        { id: row.id, companyId: row.company_id, companyName: row.company_name }
      )
  );
  return { ...page, scope: scope.kind };
}

function denied(actor: AuditActor, detail?: AuditDetail): void {
  audit(EVENTS.ACCESS_DENIED, actor, detail);
}

export { audit, EVENTS, listEntries, describeScope, denied };
export type { AuditActor, AuditDetail, AuditListQuery, AuditFilters };
