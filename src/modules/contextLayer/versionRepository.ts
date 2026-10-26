import crypto from 'node:crypto';
import config from '../../config';
import { Prisma } from '../../generated/prisma/client';
import { companyScope, orNotFound, rawRows } from '../../shared/db/baseRepository';
import { accessColumns, visibleClause } from './contextAccessRepository';
import type { AccessColumnsRow } from './contextAccessRepository';
import { likePattern } from '../../shared/db/listQuery';
import { DELETED, NOT_DELETED, RESTORED, softDeletion } from '../../shared/db/softDelete';
import type { Tx } from '../../shared/db/database';
import type { Actor } from '../../shared/types/actor';
import type { ContextStep, VersionStatus } from '../../generated/prisma/enums';

const { prisma } = config.database;

interface DraftChanges {
  step?: ContextStep;
  datasetIds?: readonly string[];
  sessionId?: string | null;
  extraction?: { report: string; mode: string | null; datasetIds: readonly string[] };
}

interface VersionRow {
  id: string;
  connection_id: string;
  name: string;
  version: number;
  status: VersionStatus;
  current_step: ContextStep | null;
  dataset_ids: Prisma.JsonValue;
  based_on_id: string | null;
  session_id: string | null;
  extraction_mode: string | null;
  extracted_at: Date | null;
  object_count: number;
  stats: Prisma.JsonValue;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  published_by: string | null;
  published_at: Date | null;
}

interface PublishedVersionRow extends VersionRow {
  datasets: Prisma.JsonValue;
}

interface DraftRow extends PublishedVersionRow {
  company_id: string;
  extraction_report: string | null;
  extraction_dataset_ids: Prisma.JsonValue;
  snapshot: Prisma.JsonValue;
  notify_team: boolean;
}

interface DeletedVersionRow {
  id: string;
  name: string;
  version: number;
  object_count: number;
}

interface ExtractionRow {
  session_id: string | null;
  extraction_mode: string | null;
  extraction_report: string | null;
  extraction_dataset_ids: Prisma.JsonValue;
  extracted_at: Date | null;
}

interface StatusHeadlineRow {
  connection_id: string;
  name: string;
  version: number;
  status: VersionStatus;
  published_at: Date | null;
  updated_at: Date;
}

interface CompanyPublishedRow extends AccessColumnsRow {
  id: string;
  connection_id: string;
  name: string;
  version: number;
  published_at: Date | null;
  object_count: number;
  connection_name: string;
  provider: string;
  host: string;
  company_id: string;
  company_name: string | null;
  published_by: string | null;
}

const COLUMNS = Prisma.sql`id, connection_id, name, version, status, current_step, dataset_ids,
  based_on_id, session_id, extraction_mode, extracted_at, object_count, stats,
  created_by, created_at, updated_at, published_by, published_at`;

const VERSION_FIELDS = {
  id: true,
  connectionId: true,
  name: true,
  version: true,
  status: true,
  currentStep: true,
  datasetIds: true,
  basedOnId: true,
  sessionId: true,
  extractionMode: true,
  extractedAt: true,
  objectCount: true,
  stats: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  publishedBy: true,
  publishedAt: true,
} satisfies Prisma.ContextLayerVersionSelect;

const EXTRACTION_FIELDS = {
  sessionId: true,
  extractionMode: true,
  extractionReport: true,
  extractionDatasetIds: true,
  extractedAt: true,
} satisfies Prisma.ContextLayerVersionSelect;

type VersionFields = Prisma.ContextLayerVersionGetPayload<{ select: typeof VERSION_FIELDS }>;
type ExtractionFields = Prisma.ContextLayerVersionGetPayload<{ select: typeof EXTRACTION_FIELDS }>;

const VERSION_NOT_FOUND = 'Published version not found';

function versionRow(v: VersionFields): VersionRow {
  return {
    id: v.id,
    connection_id: v.connectionId,
    name: v.name,
    version: v.version,
    status: v.status,
    current_step: v.currentStep,
    dataset_ids: v.datasetIds,
    based_on_id: v.basedOnId,
    session_id: v.sessionId,
    extraction_mode: v.extractionMode,
    extracted_at: v.extractedAt,
    object_count: v.objectCount,
    stats: v.stats,
    created_by: v.createdBy,
    created_at: v.createdAt,
    updated_at: v.updatedAt,
    published_by: v.publishedBy,
    published_at: v.publishedAt,
  };
}

function extractionRow(v: ExtractionFields): ExtractionRow {
  return {
    session_id: v.sessionId,
    extraction_mode: v.extractionMode,
    extraction_report: v.extractionReport,
    extraction_dataset_ids: v.extractionDatasetIds,
    extracted_at: v.extractedAt,
  };
}

async function listForConnection(connectionId: string): Promise<VersionRow[]> {
  const versions = await prisma.contextLayerVersion.findMany({
    where: { connectionId, ...NOT_DELETED },
    select: VERSION_FIELDS,
    orderBy: [{ createdAt: 'desc' }, { version: 'desc' }],
  });
  return versions.map(versionRow);
}

async function nextVersion(
  tx: Tx,
  connectionId: string,
  name: string,
  excludeId: string | null = null
): Promise<number> {
  const { _max } = await tx.contextLayerVersion.aggregate({
    _max: { version: true },
    where: { connectionId, name, ...(excludeId === null ? {} : { id: { not: excludeId } }) },
  });
  return (_max.version ?? 0) + 1;
}

async function lockDraft(tx: Tx, connectionId: string): Promise<DraftRow | null> {
  const rows = await rawRows<DraftRow>(
    tx,
    Prisma.sql`SELECT * FROM context_layer_versions
      WHERE connection_id = ${connectionId}::uuid AND status = 'draft'
      FOR UPDATE`
  );
  return rows[0] || null;
}

async function latestPublishedName(tx: Tx, connectionId: string): Promise<{ id: string; name: string } | null> {
  return tx.contextLayerVersion.findFirst({
    where: { connectionId, status: 'published', ...NOT_DELETED },
    orderBy: { publishedAt: 'desc' },
    select: { id: true, name: true },
  });
}

async function insertDraft(
  tx: Tx,
  {
    connectionId,
    companyId,
    name,
    version,
    step,
    datasetIds,
    basedOnId,
    createdBy,
  }: {
    connectionId: string;
    companyId: string | null;
    name: string;
    version: number;
    step: ContextStep | null;
    datasetIds: readonly string[];
    basedOnId: string | null;
    createdBy: string | null;
  }
): Promise<DraftRow> {
  const [row] = await rawRows<DraftRow>(
    tx,
    Prisma.sql`INSERT INTO context_layer_versions
       (id, connection_id, company_id, name, version, status, current_step,
        dataset_ids, based_on_id, created_by)
     VALUES (${crypto.randomUUID()}::uuid, ${connectionId}::uuid, ${companyId}::uuid, ${name}, ${version}, 'draft', ${step},
             ${JSON.stringify(datasetIds)}::jsonb, ${basedOnId}::uuid, ${createdBy}::uuid)
     RETURNING *`
  );
  return row;
}

async function updateDraft(tx: Tx, draftId: string, changes: DraftChanges): Promise<DraftRow | undefined> {
  const sets: Prisma.Sql[] = [Prisma.sql`updated_at = now()`];
  if (changes.step !== undefined) sets.push(Prisma.sql`current_step = ${changes.step}`);
  if (changes.datasetIds !== undefined)
    sets.push(Prisma.sql`dataset_ids = ${JSON.stringify(changes.datasetIds)}::jsonb`);
  if (changes.sessionId !== undefined) sets.push(Prisma.sql`session_id = ${changes.sessionId}`);
  if (changes.extraction) {
    sets.push(
      Prisma.sql`extraction_report = ${changes.extraction.report}`,
      Prisma.sql`extraction_mode = ${changes.extraction.mode}`,
      Prisma.sql`extraction_dataset_ids = ${JSON.stringify(changes.extraction.datasetIds)}::jsonb`,
      Prisma.sql`extracted_at = now()`
    );
  }
  const rows = await rawRows<DraftRow>(
    tx,
    Prisma.sql`UPDATE context_layer_versions SET ${Prisma.join(sets, ', ')} WHERE id = ${draftId}::uuid RETURNING *`
  );
  return rows[0];
}

async function advanceDraftStep(
  connectionId: string,
  steps: readonly string[],
  step: ContextStep
): Promise<VersionRow | null> {
  const rows = await rawRows<VersionRow>(
    prisma,
    Prisma.sql`UPDATE context_layer_versions
        SET current_step = CASE
              WHEN COALESCE(array_position(${[...steps]}::text[], current_step::text), 0)
                   < array_position(${[...steps]}::text[], ${step}::text)
              THEN ${step} ELSE current_step END,
            updated_at = now()
      WHERE connection_id = ${connectionId}::uuid AND status = 'draft'
      RETURNING ${COLUMNS}`
  );
  return rows[0] || null;
}

async function markPublished(
  tx: Tx,
  draftId: string,
  {
    name,
    version,
    sessionId,
    snapshot,
    stats,
    notifyTeam,
    datasets,
    publishedBy,
  }: {
    name: string;
    version: number;
    sessionId: string | null;
    snapshot: readonly unknown[];
    stats: unknown;
    notifyTeam: unknown;
    datasets: readonly { id: string }[];
    publishedBy: string | null;
  }
): Promise<VersionRow | undefined> {
  const datasetIds = datasets.length ? JSON.stringify(datasets.map((d) => d.id)) : null;
  const rows = await rawRows<VersionRow>(
    tx,
    Prisma.sql`UPDATE context_layer_versions
        SET name = ${name}, version = ${version}, status = 'published', current_step = 'publish',
            session_id = COALESCE(${sessionId}::text, session_id),
            object_count = ${snapshot.length}, stats = ${JSON.stringify(stats)}::jsonb,
            snapshot = ${JSON.stringify(snapshot)}::jsonb, notify_team = ${Boolean(notifyTeam)},
            datasets = ${JSON.stringify(datasets)}::jsonb, dataset_ids = COALESCE(${datasetIds}::jsonb, dataset_ids),
            published_by = ${publishedBy}::uuid, published_at = now(), updated_at = now()
      WHERE id = ${draftId}::uuid
      RETURNING ${COLUMNS}`
  );
  return rows[0];
}

async function latestPublished(connectionId: string): Promise<VersionRow | null> {
  const version = await prisma.contextLayerVersion.findFirst({
    where: { connectionId, status: 'published', ...NOT_DELETED },
    orderBy: { publishedAt: 'desc' },
    select: VERSION_FIELDS,
  });
  return version ? versionRow(version) : null;
}

async function findPublished(connectionId: string, versionId: string): Promise<PublishedVersionRow | null> {
  const version = await orNotFound(
    prisma.contextLayerVersion.findFirst({
      where: { id: versionId, connectionId, status: 'published', ...NOT_DELETED },
      select: { ...VERSION_FIELDS, datasets: true },
    }),
    VERSION_NOT_FOUND
  );
  return version ? { ...versionRow(version), datasets: version.datasets } : null;
}

async function deletePublished(
  tx: Tx,
  connectionId: string,
  versionId: string,
  deletedBy: string | null,
  { permanent = false }: { permanent?: boolean } = {}
): Promise<DeletedVersionRow | null> {
  const found = await orNotFound(
    tx.contextLayerVersion.findFirst({
      where: { id: versionId, connectionId, status: 'published', ...(permanent ? {} : NOT_DELETED) },
      select: { id: true, name: true, version: true, objectCount: true },
    }),
    VERSION_NOT_FOUND
  );
  if (!found) return null;
  const result = permanent
    ? await tx.contextLayerVersion.deleteMany({ where: { id: found.id } })
    : await tx.contextLayerVersion.updateMany({
        where: { id: found.id, ...NOT_DELETED },
        data: softDeletion(deletedBy),
      });
  if (!result.count) return null;
  return { id: found.id, name: found.name, version: found.version, object_count: found.objectCount };
}

async function restorePublished(connectionId: string, versionId: string): Promise<DeletedVersionRow | null> {
  const found = await orNotFound(
    prisma.contextLayerVersion.findFirst({
      where: { id: versionId, connectionId, status: 'published', ...DELETED },
      select: { id: true, name: true, version: true, objectCount: true },
    }),
    VERSION_NOT_FOUND
  );
  if (!found) return null;
  const result = await prisma.contextLayerVersion.updateMany({ where: { id: found.id, ...DELETED }, data: RESTORED });
  if (!result.count) return null;
  return { id: found.id, name: found.name, version: found.version, object_count: found.objectCount };
}

async function currentDraft(connectionId: string): Promise<VersionRow | null> {
  const version = await prisma.contextLayerVersion.findFirst({
    where: { connectionId, status: 'draft' },
    select: VERSION_FIELDS,
  });
  return version ? versionRow(version) : null;
}

async function latestExtraction(connectionId: string): Promise<ExtractionRow | null> {
  const version = await prisma.contextLayerVersion.findFirst({
    where: { connectionId, extractionReport: { not: null }, ...NOT_DELETED },
    orderBy: { extractedAt: 'desc' },
    select: EXTRACTION_FIELDS,
  });
  return version ? extractionRow(version) : null;
}

async function versionExtraction(connectionId: string, versionId: string): Promise<ExtractionRow | null> {
  const version = await prisma.contextLayerVersion.findFirst({
    where: { id: versionId, connectionId, extractionReport: { not: null }, ...NOT_DELETED },
    select: EXTRACTION_FIELDS,
  });
  return version ? extractionRow(version) : null;
}

async function statusHeadlines(connectionIds: readonly string[]): Promise<StatusHeadlineRow[]> {
  return rawRows<StatusHeadlineRow>(
    prisma,
    Prisma.sql`SELECT DISTINCT ON (connection_id, status)
            connection_id, name, version, status, published_at, updated_at
       FROM context_layer_versions
      WHERE connection_id = ANY(${[...connectionIds]}::uuid[]) AND deleted_at IS NULL
      ORDER BY connection_id, status, COALESCE(published_at, updated_at) DESC`
  );
}

async function listCompanyPublished(
  actor: Actor,
  seeAll: boolean,
  search?: string | null
): Promise<CompanyPublishedRow[]> {
  const conditions = [
    Prisma.sql`v.status = 'published' AND v.deleted_at IS NULL`,
    companyScope(actor, 'c.company_id'),
    visibleClause(actor, seeAll),
  ];
  if (search) {
    const pattern = likePattern(search);
    conditions.push(Prisma.sql`(v.name ILIKE ${pattern} OR c.name ILIKE ${pattern})`);
  }

  return rawRows<CompanyPublishedRow>(
    prisma,
    Prisma.sql`SELECT v.id, v.connection_id, v.name, v.version, v.published_at, v.object_count,
            c.name AS connection_name, c.provider, c.host,
            c.company_id, co.name AS company_name,
            COALESCE(u.display_name, u.username) AS published_by, ${accessColumns(actor)}
       FROM context_layer_versions v
       JOIN connections c ON c.id = v.connection_id
       LEFT JOIN companies co ON co.id = c.company_id
       LEFT JOIN users u ON u.id = v.published_by
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY v.connection_id, v.name, v.version DESC`
  );
}

export {
  listForConnection,
  nextVersion,
  lockDraft,
  latestPublishedName,
  insertDraft,
  updateDraft,
  advanceDraftStep,
  markPublished,
  latestPublished,
  findPublished,
  deletePublished,
  restorePublished,
  currentDraft,
  latestExtraction,
  versionExtraction,
  statusHeadlines,
  listCompanyPublished,
};
export type {
  DraftChanges,
  VersionRow,
  PublishedVersionRow,
  DraftRow,
  DeletedVersionRow,
  ExtractionRow,
  StatusHeadlineRow,
  CompanyPublishedRow,
};
