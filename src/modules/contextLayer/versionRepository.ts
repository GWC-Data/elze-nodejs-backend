import crypto from 'node:crypto';
import config from '../../config';
import { Prisma } from '../../generated/prisma/client';
import { companyScope, orNotFound, rawRows } from '../../shared/db/baseRepository';
import { accessColumns, visibleClause } from './contextAccessRepository';
import { likePattern } from '../../shared/db/listQuery';
import type { Tx } from '../../shared/db/database';
import type { Actor } from '../../shared/types/actor';

const { prisma } = config.database;

interface DraftChanges {
  step?: string;
  datasetIds?: unknown[];
  sessionId?: string | null;
  extraction?: { report: string; mode: string | null; datasetIds: unknown[] };
}

const COLUMNS = Prisma.sql`id, connection_id, name, version, status, current_step, dataset_ids,
  based_on_id, session_id, extraction_mode, extracted_at, object_count, stats,
  created_by, created_at, updated_at, published_by, published_at`;

const VERSION_NOT_FOUND = 'Published version not found';

async function listForConnection(connectionId: string) {
  return rawRows(
    prisma,
    Prisma.sql`SELECT ${COLUMNS} FROM context_layer_versions
      WHERE connection_id = ${connectionId}::uuid
      ORDER BY created_at DESC, version DESC`
  );
}

async function nextVersion(
  tx: Tx,
  connectionId: string,
  name: string,
  excludeId: string | null = null
): Promise<number> {
  const [row] = await rawRows(
    tx,
    Prisma.sql`SELECT COALESCE(MAX(version), 0) AS v
       FROM context_layer_versions
      WHERE connection_id = ${connectionId}::uuid AND name = ${name}
        AND (${excludeId}::uuid IS NULL OR id <> ${excludeId}::uuid)`
  );
  return Number(row.v) + 1;
}

async function lockDraft(tx: Tx, connectionId: string) {
  const rows = await rawRows(
    tx,
    Prisma.sql`SELECT * FROM context_layer_versions
      WHERE connection_id = ${connectionId}::uuid AND status = 'draft'
      FOR UPDATE`
  );
  return rows[0] || null;
}

async function latestPublishedName(tx: Tx, connectionId: string) {
  const rows = await rawRows(
    tx,
    Prisma.sql`SELECT id, name FROM context_layer_versions
      WHERE connection_id = ${connectionId}::uuid AND status = 'published'
      ORDER BY published_at DESC
      LIMIT 1`
  );
  return rows[0] || null;
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
    companyId: number | null;
    name: string;
    version: number;
    step: string;
    datasetIds: unknown;
    basedOnId: string | null;
    createdBy: number | null;
  }
) {
  const [row] = await rawRows(
    tx,
    Prisma.sql`INSERT INTO context_layer_versions
       (id, connection_id, company_id, name, version, status, current_step,
        dataset_ids, based_on_id, created_by)
     VALUES (${crypto.randomUUID()}::uuid, ${connectionId}::uuid, ${companyId}, ${name}, ${version}, 'draft', ${step},
             ${JSON.stringify(datasetIds)}::jsonb, ${basedOnId}::uuid, ${createdBy}::int)
     RETURNING *`
  );
  return row;
}

async function updateDraft(tx: Tx, draftId: string, changes: DraftChanges) {
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
  const [row] = await rawRows(
    tx,
    Prisma.sql`UPDATE context_layer_versions SET ${Prisma.join(sets, ', ')} WHERE id = ${draftId}::uuid RETURNING *`
  );
  return row;
}

async function advanceDraftStep(connectionId: string, steps: readonly string[], step: string) {
  const rows = await rawRows(
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
    publishedBy: number | null;
  }
) {
  const datasetIds = datasets.length ? JSON.stringify(datasets.map((d) => d.id)) : null;
  const [row] = await rawRows(
    tx,
    Prisma.sql`UPDATE context_layer_versions
        SET name = ${name}, version = ${version}, status = 'published', current_step = 'publish',
            session_id = COALESCE(${sessionId}::text, session_id),
            object_count = ${snapshot.length}, stats = ${JSON.stringify(stats)}::jsonb,
            snapshot = ${JSON.stringify(snapshot)}::jsonb, notify_team = ${Boolean(notifyTeam)},
            datasets = ${JSON.stringify(datasets)}::jsonb, dataset_ids = COALESCE(${datasetIds}::jsonb, dataset_ids),
            published_by = ${publishedBy}::int, published_at = now(), updated_at = now()
      WHERE id = ${draftId}::uuid
      RETURNING ${COLUMNS}`
  );
  return row;
}

async function latestPublished(connectionId: string) {
  const rows = await rawRows(
    prisma,
    Prisma.sql`SELECT ${COLUMNS} FROM context_layer_versions
      WHERE connection_id = ${connectionId}::uuid AND status = 'published'
      ORDER BY published_at DESC
      LIMIT 1`
  );
  return rows[0] || null;
}

async function findPublished(connectionId: string, versionId: unknown) {
  const rows = await orNotFound(
    rawRows(
      prisma,
      Prisma.sql`SELECT ${COLUMNS}, datasets FROM context_layer_versions
        WHERE id = ${versionId}::uuid AND connection_id = ${connectionId}::uuid AND status = 'published'`
    ),
    VERSION_NOT_FOUND
  );
  return rows[0] || null;
}

async function deletePublished(tx: Tx, connectionId: string, versionId: unknown) {
  const rows = await orNotFound(
    rawRows(
      tx,
      Prisma.sql`DELETE FROM context_layer_versions
        WHERE id = ${versionId}::uuid AND connection_id = ${connectionId}::uuid AND status = 'published'
        RETURNING id, name, version, object_count`
    ),
    VERSION_NOT_FOUND
  );
  return rows[0] || null;
}

async function currentDraft(connectionId: string) {
  const rows = await rawRows(
    prisma,
    Prisma.sql`SELECT ${COLUMNS} FROM context_layer_versions
      WHERE connection_id = ${connectionId}::uuid AND status = 'draft'`
  );
  return rows[0] || null;
}

async function latestExtraction(connectionId: string) {
  const rows = await rawRows(
    prisma,
    Prisma.sql`SELECT session_id, extraction_mode, extraction_report, extraction_dataset_ids, extracted_at
       FROM context_layer_versions
      WHERE connection_id = ${connectionId}::uuid AND extraction_report IS NOT NULL
      ORDER BY extracted_at DESC
      LIMIT 1`
  );
  return rows[0] || null;
}

async function versionExtraction(connectionId: string, versionId: string) {
  const rows = await rawRows(
    prisma,
    Prisma.sql`SELECT session_id, extraction_mode, extraction_report, extraction_dataset_ids, extracted_at
       FROM context_layer_versions
      WHERE id = ${versionId}::uuid AND connection_id = ${connectionId}::uuid AND extraction_report IS NOT NULL`
  );
  return rows[0] || null;
}

async function statusHeadlines(connectionIds: readonly string[]) {
  return rawRows(
    prisma,
    Prisma.sql`SELECT DISTINCT ON (connection_id, status)
            connection_id, name, version, status, published_at, updated_at
       FROM context_layer_versions
      WHERE connection_id = ANY(${[...connectionIds]}::uuid[])
      ORDER BY connection_id, status, COALESCE(published_at, updated_at) DESC`
  );
}

async function listCompanyPublished(actor: Actor, seeAll: boolean, search?: string | null) {
  const conditions = [
    Prisma.sql`v.status = 'published'`,
    companyScope(actor, 'c.company_id'),
    visibleClause(actor, seeAll),
  ];
  if (search) {
    const pattern = likePattern(search);
    conditions.push(Prisma.sql`(v.name ILIKE ${pattern} OR c.name ILIKE ${pattern})`);
  }

  return rawRows(
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
  currentDraft,
  latestExtraction,
  versionExtraction,
  statusHeadlines,
  listCompanyPublished,
};
export type { DraftChanges };
