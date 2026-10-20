import type { Dashboard } from '../../generated/prisma/client';
import type { CardItem, DashboardError, SlicerItem } from '../queryEngine/queryTypes';

type DateParseMap = Record<string, string>;

interface DataSourceSpec {
  type?: string;
  database?: string;
  schema?: string;
  table?: string;
  name?: string;
  dateParse?: DateParseMap;
  stringDates?: DateParseMap;
}

interface DatasetSpec {
  database?: string;
  schema?: string;
  table?: string;
}

interface LayoutSlot {
  span?: number;
  minHeight?: number;
}

interface DashboardLayout {
  cols?: number;
  gap?: string;
  kpi?: LayoutSlot;
  chart?: LayoutSlot;
  slicer?: LayoutSlot;
}

interface FormatSpec {
  type?: string;
  format?: string;
  prefix?: string;
  suffix?: string;
  digits?: number;
}

interface CardColumnSpec {
  column: string;
  mapping?: string;
  aggregation?: string;
  alias?: string;
  format?: FormatSpec | null;
}

interface GroupBySpec {
  column?: string;
}

interface DateGrainSpec {
  column?: string;
  dateTimeElement?: string;
  grain?: string;
  element?: string;
}

interface OrderByTerm {
  column?: string;
  field?: string;
  name?: string;
  direction?: string;
  dir?: string;
  order?: string;
  aggregation?: string;
  agg?: string;
}

type OrderByEntry = string | OrderByTerm;

type OrderBySpec = OrderByEntry | OrderByEntry[];

interface ComparisonSpec {
  label?: string;
  comp_val_displayed?: string;
  deltaFormat?: FormatSpec;
}

interface CardOptions {
  color?: string;
  colorMapping?: Record<string, string>;
  dualAxis?: boolean;
  stacked?: boolean;
  [option: string]: unknown;
}

type CardLimit = number | string | null;

type SeriesField = 'columns' | 'dateGrain' | 'groupBy' | 'orderBy' | 'filters' | 'distinct';

interface SeriesSpec {
  columns?: CardColumnSpec[];
  dateGrain?: DateGrainSpec | null;
  groupBy?: GroupBySpec[];
  orderBy?: OrderBySpec | null;
  filters?: unknown;
  distinct?: unknown;
  limit?: CardLimit;
}

interface CardSeries {
  main?: SeriesSpec | null;
}

interface CardSpec {
  id?: string;
  chartType?: string;
  title?: string;
  name?: string;
  description?: string;
  columns?: CardColumnSpec[];
  dateGrain?: DateGrainSpec | null;
  groupBy?: GroupBySpec[];
  orderBy?: OrderBySpec | null;
  sort?: OrderBySpec | null;
  sortBy?: OrderBySpec | null;
  filters?: unknown;
  distinct?: unknown;
  comparison?: ComparisonSpec | null;
  options?: CardOptions;
  format?: FormatSpec;
  layout?: LayoutSlot;
  limits?: CardLimit;
  series?: CardSeries | null;
}

type CardKind = 'kpi' | 'chart';

interface SlicerSpec {
  id: string;
  column: string;
  title?: string;
  type?: string;
  span?: number;
  showCount?: boolean;
}

interface DashboardSpec {
  version?: string;
  id?: string;
  title?: string;
  description?: string | null;
  companyId?: number | null;
  dataSource?: DataSourceSpec;
  source?: DataSourceSpec;
  dataset?: string | DatasetSpec;
  dateParse?: DateParseMap;
  layout?: DashboardLayout;
  slicers?: SlicerSpec[];
  cards?: CardSpec[];
  kpis?: CardSpec[];
}

type DashboardDraft = Record<string, unknown>;

type SlicerSelections = Record<string, unknown>;

type AccessLevel = string | null | undefined;

type StoredDashboard = Pick<Dashboard, 'id' | 'title' | 'description' | 'spec'> & {
  company_id: Dashboard['companyId'];
};

type DashboardListRow = Pick<Dashboard, 'id' | 'title' | 'description' | 'companyId' | 'createdBy'>;

type DashboardOrigin = 'database' | 'file';

interface DashboardEntry {
  id: string;
  title: string | undefined;
  description?: string | null;
  companyId: number | null;
  createdBy?: number | null;
  source: DashboardOrigin;
}

interface DashboardView {
  dashboard: {
    id: string | undefined;
    title: string | undefined;
    description: string | null | undefined;
  };
  layout: DashboardLayout;
  cards: CardItem[];
  slicers: SlicerItem[];
  errors: DashboardError[];
}

type DashboardAccessView = DashboardView & { accessLevel: AccessLevel };

interface CreatedDashboard {
  id: string;
  title: string;
  description: string | null;
  companyId: number | null;
  accessLevel: 'admin';
  spec: DashboardDraft;
}

interface CatalogueColumn {
  name: string;
  type: string;
  columnType: string;
  nullable: boolean;
  isNumeric: boolean;
  isDate: boolean;
  isString: boolean;
  role: 'measure' | 'dimension';
}

interface ColumnCatalogue {
  dashboardId: string | undefined;
  database: string;
  schema: string;
  table: string;
  rowCount: number;
  rowCountText: string;
  dateParse: DateParseMap;
  columns: CatalogueColumn[];
}

interface CardPreview {
  kind: CardKind;
  visual: CardItem | null;
  error: DashboardError | null;
}

export type {
  AccessLevel,
  CardColumnSpec,
  CardKind,
  CardLimit,
  CardOptions,
  CardPreview,
  CardSeries,
  CardSpec,
  CatalogueColumn,
  ColumnCatalogue,
  ComparisonSpec,
  CreatedDashboard,
  DashboardAccessView,
  DashboardDraft,
  DashboardEntry,
  DashboardLayout,
  DashboardListRow,
  DashboardOrigin,
  DashboardSpec,
  DashboardView,
  DataSourceSpec,
  DatasetSpec,
  DateGrainSpec,
  DateParseMap,
  FormatSpec,
  GroupBySpec,
  LayoutSlot,
  OrderByEntry,
  OrderBySpec,
  OrderByTerm,
  SeriesField,
  SeriesSpec,
  SlicerSelections,
  SlicerSpec,
  StoredDashboard,
};
