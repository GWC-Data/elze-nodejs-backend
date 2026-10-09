type Spec = Record<string, any>;

function dashboardSummary(d: Record<string, any>, extra?: Record<string, any>) {
  return { id: d.id, title: d.title || null, source: d.source, ...extra };
}

function columnCatalogue(spec: Spec, meta: Record<string, any>, rowCount: number) {
  return {
    dashboardId: spec.id,
    database: meta.table.database,
    schema: meta.table.schema,
    table: meta.table.table,
    rowCount,
    rowCountText: rowCount.toLocaleString('en-US'),
    dateParse: meta.dateParse || {},
    columns: meta.table.columns.map((c: Record<string, any>) => ({
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

function hydratedView(spec: Spec, data: Record<string, any>) {
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
