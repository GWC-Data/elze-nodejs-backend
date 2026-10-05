type Row = Record<string, any>;

function shapeConnection(row: Row | null | undefined, datasets?: unknown) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.company_id,
    provider: row.provider,
    name: row.name,
    host: row.host,
    secretHint: row.secret_hint,
    status: row.status,
    lastError: row.last_error || null,
    lastVerifiedAt: row.last_verified_at || null,
    createdAt: row.created_at || null,
    selectedDatasetCount: row.selectedDatasetCount === undefined
      ? undefined
      : Number(row.selectedDatasetCount),
    selectedDatasets: datasets,
  };
}

function shapeSelected(row: Row) {
  return {
    id: row.dataset_id,
    name: row.name,
    rowCount: row.row_count === null ? null : Number(row.row_count),
    columnCount: row.column_count === null ? null : Number(row.column_count),
    selectedAt: row.selected_at,
  };
}

function publishedVersionOption(row: Row) {
  return {
    id: row.id,
    connectionId: row.connection_id,
    connectionName: row.connection_name,
    name: row.name,
    version: Number(row.version),
    label: `v${row.version}`,
    live: Boolean(row.live),
    publishedAt: row.published_at,
  };
}

function listedDataset(d: Row) {
  return {
    id: String(d.id),
    name: d.name || String(d.id),
    description: null,
    rowCount: d.rowCount ?? null,
    columnCount: d.columnCount ?? null,
    owner: null,
    lastUpdated: null,
  };
}

export { shapeConnection, shapeSelected, publishedVersionOption, listedDataset };
