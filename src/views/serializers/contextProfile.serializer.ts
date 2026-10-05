type Row = Record<string, any>;

function shapeContextProfile(row: Row | null | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    connectionId: row.connection_id,
    name: row.name,
    description: row.description,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export { shapeContextProfile };
