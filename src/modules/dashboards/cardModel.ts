import { KPI_CHART_TYPES, SERIES_FIELDS } from './dashboardConstants';
import type { CardKind, CardSpec, DashboardSpec, SeriesField, SeriesSpec } from './dashboardTypes';

const KPI_TYPE_SET = new Set(KPI_CHART_TYPES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isList(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isKpiChartType(chartType: unknown): boolean {
  return KPI_TYPE_SET.has(
    String(chartType == null ? '' : chartType)
      .trim()
      .toLowerCase()
  );
}

function cardKind(card: CardSpec | null | undefined): CardKind {
  return isKpiChartType(card?.chartType) ? 'kpi' : 'chart';
}

function copySeriesField<K extends SeriesField>(target: CardSpec, main: SeriesSpec, field: K): void {
  if (target[field] == null && main[field] != null) target[field] = main[field];
}

function flattenCard(card: unknown): CardSpec {
  if (!card || typeof card !== 'object') return card as CardSpec;
  const source: CardSpec = card;
  const main = source.series?.main;
  if (!main) return source;

  const next: CardSpec = { ...source };
  for (const field of SERIES_FIELDS) copySeriesField(next, main, field);
  if (next.limits == null && main.limit != null) next.limits = main.limit;
  delete next.series;
  return next;
}

function normalizeSpec(spec: unknown): DashboardSpec {
  if (!isRecord(spec)) return spec as DashboardSpec;
  const legacyKpis = isList(spec.kpis) ? spec.kpis : [];
  const cards = isList(spec.cards) ? spec.cards : [];
  const next: DashboardSpec = { ...spec, cards: [...legacyKpis, ...cards].map(flattenCard) };
  delete next.kpis;
  return next;
}

export { cardKind, flattenCard, isList, isRecord, normalizeSpec };
