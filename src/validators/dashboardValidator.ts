import { fail, InvalidDashboardIdError } from '../tools/AppError';
import { DASHBOARD_ID_RE } from '../constants/dashboard';

type Card = Record<string, any>;

interface CardUpdate {
  index: number;
  card: Card;
  filters: any;
}

interface DraftCard {
  card: Card;
  filters: any;
}

function assertValidDashboardId(dashboardId: unknown): string {
  const id = String(dashboardId == null ? '' : dashboardId);
  if (!DASHBOARD_ID_RE.test(id)) throw new InvalidDashboardIdError(dashboardId);
  return id;
}

function parseFilters(query: Record<string, unknown> | null | undefined): Record<string, string[]> {
  const filters: Record<string, string[]> = {};
  Object.entries(query || {}).forEach(([id, val]) => {
    if (id === 'companyId') return;
    if (typeof val === 'string') filters[id] = val.split(',').map((s) => s.trim()).filter(Boolean);
  });
  return filters;
}

function requireCardUpdate(body: any): CardUpdate {
  const { index, card, filters } = body || {};
  if (!card || typeof index !== 'number') {
    throw fail('VALIDATION_ERROR', 'Expected { index, card }');
  }
  return { index, card, filters };
}

function requireDraftCard(body: any): DraftCard {
  const { card, filters } = body || {};
  if (!card || typeof card !== 'object') throw fail('VALIDATION_ERROR', 'Expected { card }');
  return { card, filters };
}

export { assertValidDashboardId, parseFilters, requireCardUpdate, requireDraftCard };
export type { CardUpdate, DraftCard };
