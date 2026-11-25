import { readBusinessLayer } from '../contextLayer/businessLayerValidator';
import { datasetFields, field, isJsonObject, jsonList } from '../contextLayer/contextTypes';
import type { ContextAccessLevel } from '../contextLayer/contextConstants';
import type { DatasetFields, JsonValue } from '../contextLayer/contextTypes';
import type { ContextVersionRow, PublishedRow, VersionListRow } from './mcpDataRepository';

interface ContextCompany {
  id: string;
  name: string | null;
}

interface ContextSummary {
  connectionId: string;
  name: string;
  connectionName: string;
  provider: string;
  company: ContextCompany | null;
  access: ContextAccessLevel;
  liveVersion: number;
  versionCount: number;
  publishedAt: Date | null;
  publishedBy: string | null;
  objectCount: number;
  datasetCount: number;
  counts: Record<string, number>;
}

interface ContextDataset {
  id: string;
  name: string;
  rowCount: number | null;
  columnCount: number | null;
  overview: string | null;
}

interface ContextOverview extends Omit<ContextSummary, 'versionCount' | 'datasetCount'> {
  version: number;
  isLive: boolean;
  tables: string[];
  datasets: ContextDataset[];
}

interface ContextVersionEntry {
  version: number;
  label: string;
  live: boolean;
  publishedAt: Date | null;
  publishedBy: string | null;
  objectCount: number;
}

function countsOf(stats: JsonValue): Record<string, number> {
  const raw = field(stats, 'counts');
  const counts: Record<string, number> = {};
  if (!isJsonObject(raw)) return counts;
  for (const [type, value] of Object.entries(raw)) {
    const n = Number(value);
    if (Number.isFinite(n)) counts[type] = n;
  }
  return counts;
}

function tablesOf(stats: JsonValue): string[] {
  return jsonList(field(stats, 'tables')).filter((t): t is string => typeof t === 'string');
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function companyOf(row: PublishedRow): ContextCompany | null {
  return row.company_id ? { id: row.company_id, name: row.company_name } : null;
}

function shapeDataset(dataset: DatasetFields, overviews: Record<string, string>): ContextDataset {
  const id = String(dataset.id ?? '');
  return {
    id,
    name: typeof dataset.name === 'string' && dataset.name ? dataset.name : id,
    rowCount: numberOrNull(dataset.rowCount),
    columnCount: numberOrNull(dataset.columnCount),
    overview: overviews[id] ?? null,
  };
}

function datasetsOf(row: ContextVersionRow): DatasetFields[] {
  return jsonList(row.datasets).map(datasetFields);
}

function overviewsOf(row: ContextVersionRow): Record<string, string> {
  return readBusinessLayer(row.business_layer).tables;
}

function shapeSummary(row: PublishedRow, access: ContextAccessLevel, versionCount: number): ContextSummary {
  return {
    connectionId: row.connection_id,
    name: row.name,
    connectionName: row.connection_name,
    provider: row.provider,
    company: companyOf(row),
    access,
    liveVersion: Number(row.version),
    versionCount,
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    objectCount: Number(row.object_count),
    datasetCount: Number(row.dataset_count),
    counts: countsOf(row.stats),
  };
}

function shapeOverview(row: ContextVersionRow, access: ContextAccessLevel): ContextOverview {
  const overviews = overviewsOf(row);
  return {
    connectionId: row.connection_id,
    name: row.name,
    connectionName: row.connection_name,
    provider: row.provider,
    company: companyOf(row),
    access,
    version: Number(row.version),
    liveVersion: Number(row.live_version),
    isLive: Number(row.version) === Number(row.live_version),
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    objectCount: Number(row.object_count),
    counts: countsOf(row.stats),
    tables: tablesOf(row.stats),
    datasets: datasetsOf(row).map((d) => shapeDataset(d, overviews)),
  };
}

function shapeVersion(row: VersionListRow, liveVersion: number): ContextVersionEntry {
  const version = Number(row.version);
  return {
    version,
    label: `v${version}`,
    live: version === liveVersion,
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    objectCount: Number(row.object_count),
  };
}

export { shapeSummary, shapeOverview, shapeVersion, shapeDataset, datasetsOf, overviewsOf };
export type { ContextSummary, ContextOverview, ContextVersionEntry, ContextDataset, ContextCompany };
