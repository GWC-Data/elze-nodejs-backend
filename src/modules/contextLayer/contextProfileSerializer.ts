import type { ContextProfileRow } from './contextProfileRepository';

interface ContextProfileView {
  id: string;
  connectionId: string;
  name: string;
  description: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function shapeContextProfile(row: ContextProfileRow): ContextProfileView;
function shapeContextProfile(row: ContextProfileRow | null | undefined): ContextProfileView | null;
function shapeContextProfile(row: ContextProfileRow | null | undefined): ContextProfileView | null {
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
export type { ContextProfileView };
