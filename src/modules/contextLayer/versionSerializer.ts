type Row = Record<string, any>;

function shapeVersion(row: Row | null | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    connectionId: row.connection_id,
    name: row.name,
    version: Number(row.version),
    label: `v${row.version}`,
    status: row.status,
    currentStep: row.current_step,
    datasetIds: Array.isArray(row.dataset_ids) ? row.dataset_ids : [],
    basedOnId: row.based_on_id,
    sessionId: row.session_id,
    extractionMode: row.extraction_mode,
    extractedAt: row.extracted_at,
    objectCount: Number(row.object_count || 0),
    stats: row.stats || {},
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedBy: row.published_by,
    publishedAt: row.published_at,
  };
}

function shapeExtraction(row: Row | null | undefined) {
  if (!row) return null;
  return {
    sessionId: row.session_id,
    text: row.extraction_report,
    mode: row.extraction_mode,
    datasetIds: Array.isArray(row.extraction_dataset_ids) ? row.extraction_dataset_ids.map(String) : null,
    extractedAt: row.extracted_at,
  };
}

function headline(row: Row) {
  return {
    name: row.name,
    version: Number(row.version),
    label: `v${row.version}`,
    status: row.status,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
  };
}

function deletedVersion(row: Row) {
  return {
    id: row.id,
    name: row.name,
    version: Number(row.version),
    label: `v${row.version}`,
    objectCount: Number(row.object_count || 0),
  };
}

export { shapeVersion, shapeExtraction, headline, deletedVersion };
