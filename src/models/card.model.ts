import { KPI_CHART_TYPES, SERIES_FIELDS } from '../constants/dashboard';

type Card = Record<string, any>;
type DashboardSpec = Record<string, any>;

const KPI_TYPE_SET = new Set(KPI_CHART_TYPES);

function isKpiChartType(chartType: unknown): boolean {
  return KPI_TYPE_SET.has(String(chartType == null ? '' : chartType).trim().toLowerCase());
}

function cardKind(card: Card | null | undefined): 'kpi' | 'chart' {
  return isKpiChartType(card && card.chartType) ? 'kpi' : 'chart';
}

function flattenCard(card: any): any {
  if (!card || typeof card !== 'object') return card;
  const main = card.series && card.series.main;
  if (!main) return card;

  const next: Card = { ...card };
  for (const field of SERIES_FIELDS) {
    if (next[field] == null && main[field] != null) next[field] = main[field];
  }
  if (next.limits == null && main.limit != null) next.limits = main.limit;
  delete next.series;
  return next;
}

function normalizeSpec(spec: any): any {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return spec;
  const legacyKpis = Array.isArray(spec.kpis) ? spec.kpis : [];
  const cards = Array.isArray(spec.cards) ? spec.cards : [];
  const next: DashboardSpec = { ...spec, cards: [...legacyKpis, ...cards].map(flattenCard) };
  delete next.kpis;
  return next;
}

export {
  cardKind,
  flattenCard,
  normalizeSpec,
};
export type { Card, DashboardSpec };
