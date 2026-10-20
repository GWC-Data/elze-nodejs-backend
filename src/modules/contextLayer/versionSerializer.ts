import type { ContextStep, VersionStatus } from '../../generated/prisma/enums';
import type { DeletedVersionRow, ExtractionRow, StatusHeadlineRow, VersionRow } from './versionRepository';
import type { JsonValue, PublishedDataset } from './contextTypes';

interface Version {
  id: string;
  connectionId: string;
  name: string;
  version: number;
  label: string;
  status: VersionStatus;
  currentStep: ContextStep | null;
  datasetIds: JsonValue[];
  basedOnId: string | null;
  sessionId: string | null;
  extractionMode: string | null;
  extractedAt: Date | null;
  objectCount: number;
  stats: JsonValue;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
  publishedBy: number | null;
  publishedAt: Date | null;
}

interface PublishedVersion extends Version {
  datasets: PublishedDataset[];
}

interface Extraction {
  sessionId: string | null;
  text: string | null;
  mode: string | null;
  datasetIds: string[] | null;
  extractedAt: Date | null;
}

interface Headline {
  name: string;
  version: number;
  label: string;
  status: VersionStatus;
  publishedAt: Date | null;
  updatedAt: Date;
}

interface DeletedVersion {
  id: string;
  name: string;
  version: number;
  label: string;
  objectCount: number;
}

function shapeVersion(row: VersionRow): Version;
function shapeVersion(row: VersionRow | null | undefined): Version | null;
function shapeVersion(row: VersionRow | null | undefined): Version | null {
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

function shapeExtraction(row: ExtractionRow | null | undefined): Extraction | null {
  if (!row) return null;
  return {
    sessionId: row.session_id,
    text: row.extraction_report,
    mode: row.extraction_mode,
    datasetIds: Array.isArray(row.extraction_dataset_ids) ? row.extraction_dataset_ids.map(String) : null,
    extractedAt: row.extracted_at,
  };
}

function headline(row: StatusHeadlineRow): Headline {
  return {
    name: row.name,
    version: Number(row.version),
    label: `v${row.version}`,
    status: row.status,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
  };
}

function deletedVersion(row: DeletedVersionRow): DeletedVersion {
  return {
    id: row.id,
    name: row.name,
    version: Number(row.version),
    label: `v${row.version}`,
    objectCount: Number(row.object_count || 0),
  };
}

export { shapeVersion, shapeExtraction, headline, deletedVersion };
export type { Version, PublishedVersion, Extraction, Headline, DeletedVersion };
