import { resolveColumn } from './metadataService';
import { validateAggregation, resolveSortDirection, resolveDateGrain } from './semanticLayerService';
import type {
  CardColumnSpec,
  CardSpec,
  DashboardSpec,
  OrderByTerm,
  SeriesSpec,
  SlicerSelections,
  SlicerSpec,
} from '../dashboards/dashboardTypes';
import type {
  CardPlan,
  ColumnMeta,
  DateGroupNode,
  DatePeriod,
  DimensionNode,
  FilterNode,
  KpiPlan,
  MeasureNode,
  OrderNode,
  SlicerPlan,
  SourceMetadata,
} from './queryTypes';

const GROUPING_MAPPINGS: ReadonlyArray<string | undefined> = ['XTIME', 'SERIES', 'ITEM'];

function getColumn(meta: SourceMetadata, name: string): ColumnMeta {
  return resolveColumn(meta.table, name);
}

function tableName(meta: SourceMetadata | null | undefined): string | undefined {
  return meta?.table ? meta.table.table : undefined;
}

function sameColumn(a: unknown, b: unknown): boolean {
  return String(a || '').toLowerCase() === String(b || '').toLowerCase();
}

function parseFormatOf(meta: SourceMetadata, column: string, colMeta: ColumnMeta): string | null {
  const formats: Record<string, string> = meta.dateParse || {};
  if (formats[column]) return formats[column];
  const key = Object.keys(formats).find((k) => sameColumn(k, column) || sameColumn(k, colMeta?.name));
  return key ? formats[key] : null;
}

function buildDateGroup(meta: SourceMetadata, column: string, grain: unknown): DateGroupNode {
  const colMeta = getColumn(meta, column);
  const resolved = resolveDateGrain(grain);
  return {
    column,
    grain: resolved.key,
    isString: colMeta.isString,
    parseFormat: parseFormatOf(meta, column, colMeta),
    columnMeta: colMeta,
  };
}

function readDateGrainSpec(node: CardSpec | SeriesSpec | null | undefined): DatePeriod | null {
  const dg = node?.dateGrain;
  if (!dg || typeof dg !== 'object') return null;
  const column = dg.column;
  const grain = dg.dateTimeElement || dg.grain || dg.element;
  if (!column || !grain) return null;
  return { column, grain };
}

function buildMeasure(meta: SourceMetadata, columnName: string, aggregation: unknown, alias: string): MeasureNode {
  const colMeta = getColumn(meta, columnName);
  const resolved = validateAggregation(aggregation || 'SUM', columnName, colMeta, tableName(meta));
  return {
    column: columnName,
    aggregation: resolved,
    alias,
    columnMeta: colMeta,
  };
}

function buildFilters(
  spec: DashboardSpec,
  filters: SlicerSelections | null | undefined,
  meta: SourceMetadata
): FilterNode[] {
  const list: FilterNode[] = [];
  if (!filters) return list;
  for (const s of spec.slicers || []) {
    const selected = filters[s.id];
    if (selected === undefined || selected === null || selected === '') continue;
    const values: unknown[] = Array.isArray(selected) ? selected : [selected];
    if (values.some((v) => v === null || typeof v === 'object')) {
      throw new Error(`The selection for slicer "${s.id}" must be a value or a list of values.`);
    }
    if (!values.length) continue;
    const colMeta = getColumn(meta, s.column);
    list.push({
      column: s.column,
      operator: 'IN',
      values: values.map(String),
      columnMeta: colMeta,
    });
  }
  return list;
}

function isOrderByTerm(entry: unknown): entry is OrderByTerm {
  return typeof entry === 'object' && entry !== null;
}

function normalizeOrderBySpec(raw: unknown): OrderByTerm[] {
  if (raw == null) return [];
  const list: unknown[] = Array.isArray(raw) ? raw : [raw];
  return list.map((entry) => (typeof entry === 'string' ? { column: entry } : entry)).filter(isOrderByTerm);
}

function buildOrderBy(
  card: CardSpec,
  meta: SourceMetadata,
  measures: MeasureNode[],
  dimensions: DimensionNode[],
  dateGroup: DateGroupNode | null
): OrderNode[] {
  const entries = normalizeOrderBySpec(
    card.orderBy != null ? card.orderBy : card.sort != null ? card.sort : card.sortBy
  );
  if (!entries.length) return [];

  return entries.map((entry) => {
    const column = entry.column || entry.field || entry.name;
    if (!column) {
      throw new Error('Invalid orderBy entry: expected a "column" (or "field") name');
    }
    const colMeta = getColumn(meta, column);
    const direction = resolveSortDirection(
      entry.direction != null ? entry.direction : entry.dir != null ? entry.dir : entry.order
    );

    if (dateGroup && sameColumn(column, dateGroup.column)) {
      return { column, direction, dateGroup, columnMeta: colMeta };
    }

    const explicitAgg = entry.aggregation != null ? entry.aggregation : entry.agg;
    if (explicitAgg) {
      return {
        column,
        direction,
        columnMeta: colMeta,
        aggregation: validateAggregation(explicitAgg, column, colMeta, tableName(meta)),
      };
    }

    const measure = measures.find((m) => sameColumn(m.column, column));
    if (measure) {
      return { column, direction, columnMeta: colMeta, aggregation: measure.aggregation };
    }

    const isDimension = dimensions.some((d) => sameColumn(d.column, column));
    if (!isDimension && (dimensions.length || dateGroup || measures.length)) {
      throw new Error(
        `orderBy column "${column}" must be one of the card's groupBy dimensions or measures, ` +
          'or must specify an "aggregation".'
      );
    }

    return { column, direction, columnMeta: colMeta, aggregation: null };
  });
}

function readLimit(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '' || String(raw).toLowerCase() === 'all') return null;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error(`Card "limits" must be a whole number of rows, 0 or "all" for no limit (got "${raw}").`);
  }
  return limit || null;
}

function cardColumns(card: CardSpec | null | undefined): CardColumnSpec[] {
  return (card && (card.columns || card.series?.main?.columns)) || [];
}

function kpiValueColumn(kpi: CardSpec | null | undefined): CardColumnSpec | null {
  const columns = cardColumns(kpi);
  return columns.find((c) => c.mapping === 'VALUE') || columns[0] || null;
}

function readKpiPeriod(kpi: CardSpec | null | undefined): DatePeriod | null {
  if (!kpi?.comparison) return null;
  return readDateGrainSpec(kpi) || readDateGrainSpec(kpi.series?.main);
}

function planKpi(kpi: CardSpec, filtersList: FilterNode[], meta: SourceMetadata, specIndex: number): KpiPlan {
  const vCol = kpiValueColumn(kpi);
  if (!vCol) {
    throw new Error('KPI card has no value column: add a field with the "Value" role.');
  }

  const measure = buildMeasure(meta, vCol.column, vCol.aggregation, '_value');
  const period = readKpiPeriod(kpi);

  if (period) {
    return {
      kind: 'kpi-period',
      id: kpi.id,
      specIndex,
      kpi,
      source: meta.source,
      measures: [measure],
      dateGroup: buildDateGroup(meta, period.column, period.grain),
      orderBy: [],
      filters: filtersList,
      limit: null,
    };
  }

  return {
    kind: 'kpi-simple',
    id: kpi.id,
    specIndex,
    kpi,
    source: meta.source,
    measures: [measure],
    dateGroup: null,
    orderBy: [],
    filters: filtersList,
    limit: null,
  };
}

function planCard(card: CardSpec, filtersList: FilterNode[], meta: SourceMetadata, specIndex: number): CardPlan {
  const columns = cardColumns(card);
  const valueCols = columns.filter((c) => c.mapping === 'VALUE');
  const xCol = columns.find((c) => GROUPING_MAPPINGS.includes(c.mapping));

  const groupByColumns: string[] = [];
  if (card.groupBy?.length) {
    for (const g of card.groupBy) {
      if (g.column) groupByColumns.push(g.column);
    }
  } else if (xCol) {
    groupByColumns.push(xCol.column);
  }

  const dateGrainSpec = readDateGrainSpec(card) || readDateGrainSpec(card.series?.main);
  const dateGroup = dateGrainSpec ? buildDateGroup(meta, dateGrainSpec.column, dateGrainSpec.grain) : null;

  const measures = valueCols.map((c) => buildMeasure(meta, c.column, c.aggregation, c.column));

  const dimensions: DimensionNode[] = groupByColumns
    .filter((c) => !dateGroup || !sameColumn(c, dateGroup.column))
    .map((c) => ({ column: c, columnMeta: getColumn(meta, c) }));

  const grouped = [...dimensions.map((d) => d.column), ...(dateGroup ? [dateGroup.column] : [])];
  const clash = measures.find((m) => grouped.some((g) => sameColumn(g, m.column)));
  if (clash) {
    throw new Error(
      `"${clash.column}" is both a group and a value in this card, so their results would overwrite each other. ` +
        `Use another column as the value; to count rows per ${clash.column}, count a column that is never empty.`
    );
  }

  return {
    kind: 'card',
    id: card.id,
    specIndex,
    card,
    chartType: card.chartType,
    source: meta.source,
    measures,
    dimensions,
    dateGroup,
    orderBy: buildOrderBy(card, meta, measures, dimensions, dateGroup),
    limit: readLimit(card.limits),
    filters: filtersList,
  };
}

function planSlicer(slicer: SlicerSpec, meta: SourceMetadata, specIndex: number): SlicerPlan {
  const colMeta = getColumn(meta, slicer.column);
  return {
    kind: 'slicer',
    id: slicer.id,
    specIndex,
    slicer,
    source: meta.source,
    column: slicer.column,
    columnMeta: colMeta,
  };
}

export { buildFilters, kpiValueColumn, readKpiPeriod, planKpi, planCard, planSlicer };
