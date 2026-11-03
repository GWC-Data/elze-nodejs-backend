import type { HydratedDashboard, SourceMetadata } from '../queryEngine/queryTypes';
import type { ColumnCatalogue, DashboardEntry, DashboardSpec, DashboardView } from './dashboardTypes';

function dashboardSummary<E extends Record<string, unknown>>(
  d: Pick<DashboardEntry, 'id' | 'title' | 'source'>,
  extra?: E
) {
  return { id: d.id, title: d.title || null, source: d.source, ...extra };
}

function columnCatalogue(spec: DashboardSpec, meta: SourceMetadata, rowCount: number): ColumnCatalogue {
  return {
    dashboardId: spec.id,
    database: meta.table.database,
    schema: meta.table.schema,
    table: meta.table.table,
    rowCount,
    rowCountText: rowCount.toLocaleString('en-US'),
    dateParse: meta.dateParse || {},
    columns: meta.table.columns.map((c) => ({
      name: c.name,
      type: c.type,
      columnType: c.columnType,
      nullable: c.nullable,
      isNumeric: c.isNumeric,
      isDate: c.isDate,
      isString: c.isString,
      role: c.isNumeric ? 'measure' : 'dimension',
    })),
  };
}

function hydratedView(spec: DashboardSpec, data: HydratedDashboard): DashboardView {
  return {
    dashboard: {
      id: spec.id,
      title: spec.title,
      description: spec.description,
    },
    layout: spec.layout || {},
    cards: data.cards,
    slicers: data.slicers,
    errors: data.errors || [],
  };
}

export { dashboardSummary, columnCatalogue, hydratedView };
