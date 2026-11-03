import type { CardOptions, CardSpec, DateParseMap, FormatSpec, SlicerSpec } from '../dashboards/dashboardTypes';

interface ColumnTypeInfo {
  type: string;
  isDate: boolean;
  isNumeric: boolean;
  isString: boolean;
  isTemporal: boolean;
}

interface ColumnMeta extends ColumnTypeInfo {
  name: string;
  columnType: string;
  nullable: boolean;
}

interface TableColumnRow {
  name: string;
  column_type: string;
  typname: string;
  nullable: boolean;
}

interface SourceRef {
  database: string;
  schema: string;
  table: string;
}

interface TableMetadata extends SourceRef {
  columns: ColumnMeta[];
  columnMap: Map<string, ColumnMeta>;
  byLower: Map<string, ColumnMeta>;
}

interface SourceMetadata {
  source: SourceRef;
  table: TableMetadata;
  columns: Map<string, ColumnMeta>;
  dateParse: DateParseMap;
}

interface DatePeriod {
  column: string;
  grain: string;
}

interface MeasureNode {
  column: string;
  aggregation: string;
  alias: string;
  columnMeta: ColumnMeta;
}

interface DimensionNode {
  column: string;
  columnMeta: ColumnMeta;
}

interface DateGroupNode {
  column: string;
  grain: string;
  isString: boolean;
  parseFormat: string | null;
  columnMeta: ColumnMeta;
}

interface FilterNode {
  column: string;
  operator: string;
  values: string[];
  columnMeta: ColumnMeta;
}

interface OrderNode {
  column: string;
  direction: string;
  columnMeta: ColumnMeta;
  dateGroup?: DateGroupNode;
  aggregation?: string | null;
}

interface KpiSimplePlan {
  kind: 'kpi-simple';
  id: string | undefined;
  specIndex: number;
  kpi: CardSpec;
  source: SourceRef;
  measures: MeasureNode[];
  dateGroup: null;
  orderBy: OrderNode[];
  filters: FilterNode[];
  limit: null;
}

interface KpiPeriodPlan {
  kind: 'kpi-period';
  id: string | undefined;
  specIndex: number;
  kpi: CardSpec;
  source: SourceRef;
  measures: MeasureNode[];
  dateGroup: DateGroupNode;
  orderBy: OrderNode[];
  filters: FilterNode[];
  limit: null;
}

type KpiPlan = KpiSimplePlan | KpiPeriodPlan;

interface MergedKpiMember {
  id: string | undefined;
  specIndex: number;
  kpi: CardSpec;
  measure: MeasureNode;
  alias: string;
}

interface KpiMergedPlan {
  kind: 'kpi-period-merged';
  id: string;
  specIndex: number;
  source: SourceRef;
  members: MergedKpiMember[];
  dateGroup: DateGroupNode;
  orderBy: OrderNode[];
  filters: FilterNode[];
  limit: null;
}

type KpiQueryPlan = KpiPlan | KpiMergedPlan;

interface CardPlan {
  kind: 'card';
  id: string | undefined;
  specIndex: number;
  card: CardSpec;
  chartType: string | undefined;
  source: SourceRef;
  measures: MeasureNode[];
  dimensions: DimensionNode[];
  dateGroup: DateGroupNode | null;
  orderBy: OrderNode[];
  limit: number | null;
  filters: FilterNode[];
}

interface SlicerPlan {
  kind: 'slicer';
  id: string;
  specIndex: number;
  slicer: SlicerSpec;
  source: SourceRef;
  column: string;
  columnMeta: ColumnMeta;
}

type QueryPlan = KpiQueryPlan | CardPlan | SlicerPlan;

type PlanKind = QueryPlan['kind'];

interface GeneratedSql {
  sql: string;
  params: string[];
  meta: { type: PlanKind; plan: QueryPlan };
}

type ResultRow = Record<string, unknown>;

interface QueryResultSet {
  rows: ResultRow[];
  elapsed: number;
}

interface CachedQueryResult extends QueryResultSet {
  cached: boolean;
}

interface StageError {
  stage: string;
  message: string;
}

interface AxisTick {
  value: number;
  label: string;
}

interface ChartAxis {
  key: string;
  type: 'category' | 'number';
  ticks?: AxisTick[];
}

interface ChartAxes {
  x?: ChartAxis;
  y?: ChartAxis;
  y2?: ChartAxis;
}

interface BarLineSeries {
  key: string;
  name: string;
  kind: 'bar' | 'line';
  axis: 'y1' | 'y2';
  color: string;
}

interface AreaSeries {
  key: string;
  name: string;
  kind: 'area';
  color: string;
  stackId: string | undefined;
  fillOpacity: number;
}

type ChartSeries = BarLineSeries | AreaSeries;

interface SeriesPoint {
  label: unknown;
  text?: Record<string, string>;
  [key: string]: unknown;
}

interface SharePoint {
  name: string;
  value: number;
  valueText: string;
  shareText: string;
}

type ChartPoint = SeriesPoint | SharePoint;

type ChartOptions = CardOptions & { height: number; totalText?: string };

interface ChartView {
  id: string | undefined;
  chartType: string | undefined;
  title: string | undefined;
  description: string | undefined;
  data: ChartPoint[];
  axes: ChartAxes;
  series: ChartSeries[];
  options: ChartOptions;
}

interface ChartCardView extends ChartView {
  spec: CardSpec;
}

interface ChartErrorView extends ChartCardView {
  error: StageError;
}

interface KpiComparison {
  label: string;
  delta: number;
  deltaText: string;
  previousText: string;
  period: string;
  previousPeriod: string;
}

interface KpiView {
  id: string | undefined;
  chartType: string | undefined;
  title: string | undefined;
  description: string | undefined;
  value: number;
  text: string;
  format: FormatSpec;
  color: string | null;
  comparison: KpiComparison;
  spec: CardSpec;
}

interface KpiErrorView extends KpiView {
  error: StageError;
}

type CardView = KpiView | ChartCardView;

type CardItem = CardView | KpiErrorView | ChartErrorView;

interface SlicerOption {
  value: string;
  count: number;
  selected: boolean;
}

interface SlicerView {
  id: string | undefined;
  title: string | undefined;
  column: string | undefined;
  type: string;
  span: number | undefined;
  showCount: boolean | undefined;
  options: SlicerOption[];
}

interface SlicerErrorView extends SlicerView {
  error: StageError;
}

type SlicerItem = SlicerView | SlicerErrorView;

interface DashboardError extends StageError {
  kind: string;
  id: string | undefined;
}

interface QueryStats {
  kpiQueries: number;
  cardQueries: number;
  slicerQueries: number;
  totalQueries: number;
  cacheHits: number;
  errors: number;
}

interface HydratedDashboard {
  cards: CardItem[];
  slicers: SlicerItem[];
  errors: DashboardError[];
  _stats: QueryStats;
}

export type {
  AreaSeries,
  AxisTick,
  BarLineSeries,
  CachedQueryResult,
  CardItem,
  CardPlan,
  CardView,
  ChartAxes,
  ChartAxis,
  ChartCardView,
  ChartErrorView,
  ChartOptions,
  ChartPoint,
  ChartSeries,
  ChartView,
  ColumnMeta,
  ColumnTypeInfo,
  DashboardError,
  DateGroupNode,
  DatePeriod,
  DimensionNode,
  FilterNode,
  GeneratedSql,
  HydratedDashboard,
  KpiComparison,
  KpiErrorView,
  KpiMergedPlan,
  KpiPeriodPlan,
  KpiPlan,
  KpiQueryPlan,
  KpiSimplePlan,
  KpiView,
  MeasureNode,
  MergedKpiMember,
  OrderNode,
  PlanKind,
  QueryPlan,
  QueryResultSet,
  QueryStats,
  ResultRow,
  SeriesPoint,
  SharePoint,
  SlicerErrorView,
  SlicerItem,
  SlicerOption,
  SlicerPlan,
  SlicerView,
  SourceMetadata,
  SourceRef,
  StageError,
  TableColumnRow,
  TableMetadata,
};
