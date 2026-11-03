import { fail, InvalidDashboardIdError } from '../../shared/errors/AppError';
import { DASHBOARD_ID_RE } from './dashboardConstants';
import { isRecord } from './cardModel';
import type { CardSpec, SlicerSelections } from './dashboardTypes';

interface CardUpdate {
  index: number;
  card: CardSpec;
  filters: SlicerSelections | undefined;
}

interface DraftCard {
  card: CardSpec;
  filters: SlicerSelections | undefined;
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
    if (typeof val === 'string')
      filters[id] = val
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
  });
  return filters;
}

function bodyFields(body: unknown): Record<string, unknown> {
  return isRecord(body) ? body : {};
}

function requireCardUpdate(body: unknown): CardUpdate {
  const { index, card, filters } = bodyFields(body);
  if (!card || typeof index !== 'number') {
    throw fail('VALIDATION_ERROR', 'Expected { index, card }');
  }
  return { index, card, filters: isRecord(filters) ? filters : undefined };
}

function requireDraftCard(body: unknown): DraftCard {
  const { card, filters } = bodyFields(body);
  if (!card || typeof card !== 'object') throw fail('VALIDATION_ERROR', 'Expected { card }');
  return { card, filters: isRecord(filters) ? filters : undefined };
}

export { assertValidDashboardId, parseFilters, requireCardUpdate, requireDraftCard };
export type { CardUpdate, DraftCard };
