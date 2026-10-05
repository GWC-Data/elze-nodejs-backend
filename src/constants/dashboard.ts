const DASHBOARD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const KPI_CHART_TYPES = ['badge_multi_value', 'badge', 'kpi', 'scorecard'];

const SERIES_FIELDS = ['columns', 'dateGrain', 'groupBy', 'orderBy', 'filters', 'distinct'];

const NEW_DASHBOARD_VERSION = '15';

const DEFAULT_DATA_SOURCE = {
  type: 'postgres',
  schema: 'public',
  table: 'cinema_analysis',
};

const DEFAULT_LAYOUT = {
  cols: 12,
  gap: 'sm',
  kpi: { span: 3, minHeight: 130 },
  chart: { span: 6, minHeight: 360 },
  slicer: { span: 3, minHeight: 44 },
};

const DEFAULT_CHART_MIN_HEIGHT = 360;

export {
  DASHBOARD_ID_RE,
  KPI_CHART_TYPES,
  SERIES_FIELDS,
  NEW_DASHBOARD_VERSION,
  DEFAULT_DATA_SOURCE,
  DEFAULT_LAYOUT,
  DEFAULT_CHART_MIN_HEIGHT,
};
