import { resolveColumn } from './metadata.service';
import { validateAggregation, resolveSortDirection, resolveDateGrain } from './semanticLayer.service';

type Meta = Record<string, any>;
type Spec = Record<string, any>;
type Plan = Record<string, any>;

function getColumn(meta: Meta, name: string): any {
  return resolveColumn(meta.table, name);
}

function tableName(meta: Meta | null | undefined): string | undefined {
  return meta && meta.table ? meta.table.table : undefined;
}

function sameColumn(a: unknown, b: unknown): boolean {
  return String(a || '').toLowerCase() === String(b || '').toLowerCase();
}

function buildDateGroup(meta: Meta, column: string, grain: unknown): Plan {
  const colMeta = getColumn(meta, column);
  const resolved = resolveDateGrain(grain);
  return {
    column,
    grain: resolved.key,
    isString: colMeta.isString,
    parseFormat: (meta.dateParse && meta.dateParse[column]) || null,
    columnMeta: colMeta,
  };
}

function readDateGrainSpec(node: Spec | null | undefined): { column: string; grain: any } | null {
  const dg = node && node.dateGrain;
  if (!dg || typeof dg !== 'object') return null;
  const column = dg.column;
  const grain = dg.dateTimeElement || dg.grain || dg.element;
  if (!column || !grain) return null;
  return { column, grain };
}

function buildMeasure(meta: Meta, columnName: string, aggregation: unknown, alias: string): Plan {
  const colMeta = getColumn(meta, columnName);
  const resolved = validateAggregation(aggregation || 'SUM', columnName, colMeta, tableName(meta));
  return {
    column: columnName,
    aggregation: resolved,
    alias,
    columnMeta: colMeta,
  };
}

function buildFilters(spec: Spec, filters: Record<string, any> | null | undefined, meta: Meta): Plan[] {
  const list: Plan[] = [];
  if (!filters) return list;
  for (const s of spec.slicers || []) {
    const selected = filters[s.id];
    if (!selected || !selected.length) continue;
    const colMeta = getColumn(meta, s.column);
    list.push({
      column: s.column,
      operator: 'IN',
      values: selected.map(String),
      columnMeta: colMeta,
    });
  }
  return list;
}

function normalizeOrderBySpec(raw: unknown): any[] {
  if (raw == null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((entry: any) => (typeof entry === 'string' ? { column: entry } : entry))
    .filter((entry) => entry && typeof entry === 'object');
}

function buildOrderBy(card: Spec, meta: Meta, measures: Plan[], dimensions: Plan[], dateGroup: Plan | null): Plan[] {
  const entries = normalizeOrderBySpec(card.orderBy != null ? card.orderBy : (card.sort != null ? card.sort : card.sortBy));
  if (!entries.length) return [];

  return entries.map((entry) => {
    const column = entry.column || entry.field || entry.name;
    if (!column) {
      throw new Error('Invalid orderBy entry: expected a "column" (or "field") name');
    }
    const colMeta = getColumn(meta, column);
    const direction = resolveSortDirection(
      entry.direction != null ? entry.direction : (entry.dir != null ? entry.dir : entry.order)
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
    if (!isDimension && (dimensions.length || dateGroup)) {
      throw new Error(
        `orderBy column "${column}" must be one of the card's groupBy dimensions or measures, ` +
        'or must specify an "aggregation".'
      );
    }

    return { column, direction, columnMeta: colMeta, aggregation: null };
  });
}

function cardColumns(card: Spec | null | undefined): any[] {
  return (card && (card.columns || card.series?.main?.columns)) || [];
}

function kpiValueColumn(kpi: Spec): any {
  const columns = cardColumns(kpi);
  return columns.find((c) => c.mapping === 'VALUE') || columns[0] || null;
}

function readKpiPeriod(kpi: Spec | null | undefined): { column: string; grain: any } | null {
  if (!kpi || !kpi.comparison) return null;
  return readDateGrainSpec(kpi) || readDateGrainSpec(kpi.series?.main);
}

function planKpi(kpi: Spec, filtersList: Plan[], meta: Meta, specIndex: number): Plan {
  const vCol = kpiValueColumn(kpi);
  if (!vCol) {
    throw new Error('KPI card has no value column: add a field with the "Value" role.');
  }

  const measure = buildMeasure(meta, vCol.column, vCol.aggregation, '_value');
  const period = readKpiPeriod(kpi);

  return {
    kind: period ? 'kpi-period' : 'kpi-simple',
    id: kpi.id,
    specIndex,
    kpi,
    source: meta.source,
    measures: [measure],
    dateGroup: period ? buildDateGroup(meta, period.column, period.grain) : null,
    orderBy: [],
    filters: filtersList,
    limit: null,
  };
}

function planCard(card: Spec, filtersList: Plan[], meta: Meta, specIndex: number): Plan {
  const columns = cardColumns(card);
  const valueCols = columns.filter((c) => c.mapping === 'VALUE');
  const xCol = columns.find((c) => ['XTIME', 'SERIES', 'ITEM'].includes(c.mapping));

  const groupByColumns: string[] = [];
  if (card.groupBy && card.groupBy.length) {
    for (const g of card.groupBy) {
      if (g.column) groupByColumns.push(g.column);
    }
  } else if (xCol) {
    groupByColumns.push(xCol.column);
  }

  const dateGrainSpec = readDateGrainSpec(card) || readDateGrainSpec(card.series?.main);
  const dateGroup = dateGrainSpec
    ? buildDateGroup(meta, dateGrainSpec.column, dateGrainSpec.grain)
    : null;

  const measures = valueCols.map((c) => buildMeasure(meta, c.column, c.aggregation, c.column));

  const dimensions = groupByColumns
    .filter((c) => !dateGroup || !sameColumn(c, dateGroup.column))
    .map((c) => ({ column: c, columnMeta: getColumn(meta, c) }));

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
    limit: card.limits ? parseInt(card.limits, 10) : null,
    filters: filtersList,
  };
}

function planSlicer(slicer: Spec, meta: Meta, specIndex: number): Plan {
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

export {
  buildFilters,
  kpiValueColumn,
  readKpiPeriod,
  planKpi,
  planCard,
  planSlicer,
};
