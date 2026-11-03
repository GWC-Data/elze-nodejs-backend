import type { ConnectionStatus } from '../../generated/prisma/enums';
import type { ConnectionRow, PublishedVersionOptionRow, SelectedDatasetRow } from './connectionRepository';
import type { DatasetFields } from './contextTypes';

interface ShapedConnection<D, A> {
  id: string;
  companyId: string;
  provider: string;
  name: string;
  host: string;
  secretHint: string;
  status: ConnectionStatus;
  lastError: string | null;
  lastVerifiedAt: Date | null;
  createdAt: Date | null;
  selectedDatasetCount: number | undefined;
  selectedDatasets: D;
  access: A;
}

interface SelectedDataset {
  id: string;
  name: string | null;
  rowCount: number | null;
  columnCount: number | null;
  selectedAt: Date;
}

interface PublishedVersionOption {
  id: string;
  connectionId: string;
  connectionName: string;
  name: string;
  version: number;
  label: string;
  live: boolean;
  publishedAt: Date | null;
}

interface ListedDataset {
  id: string;
  name: unknown;
  description: null;
  rowCount: unknown;
  columnCount: unknown;
  owner: null;
  lastUpdated: null;
}

function shapeConnection<D, A>(
  row: ConnectionRow & { selectedDatasetCount?: number },
  datasets: D,
  access: A
): ShapedConnection<D, A> {
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
    selectedDatasetCount: row.selectedDatasetCount === undefined ? undefined : Number(row.selectedDatasetCount),
    selectedDatasets: datasets,
    access,
  };
}

function shapeSelected(row: SelectedDatasetRow): SelectedDataset {
  return {
    id: row.dataset_id,
    name: row.name,
    rowCount: row.row_count === null ? null : Number(row.row_count),
    columnCount: row.column_count === null ? null : Number(row.column_count),
    selectedAt: row.selected_at,
  };
}

function publishedVersionOption(row: PublishedVersionOptionRow): PublishedVersionOption {
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

function listedDataset(d: DatasetFields): ListedDataset {
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
export type { ShapedConnection, SelectedDataset, PublishedVersionOption, ListedDataset };
