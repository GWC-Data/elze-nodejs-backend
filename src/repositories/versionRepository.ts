import crypto from 'crypto';
import config from '../config';
import { CT } from '../models/contextModel';
import { T } from '../models/rbacModel';
import { companyScope, queryOrNotFound } from './baseRepository';
import { accessColumns, visibleClause } from './contextAccessRepository';
import { likePattern } from '../tools/listQuery';
import type { Queryable } from '../config/pgPool';
import type { Actor } from '../types/actor';

const { db } = config.database;

const COLUMNS = `id, connection_id, name, version, status, current_step, dataset_ids,
  based_on_id, session_id, extraction_mode, extracted_at, object_count, stats,
  created_by, created_at, updated_at, published_by, published_at`;

const VERSION_NOT_FOUND = 'Published version not found';

async function listForConnection(connectionId: string) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM ${CT.versions}
      WHERE connection_id = ?::uuid
      ORDER BY created_at DESC, version DESC`,
    [connectionId]
  );
  return rows;
}

async function nextVersion(conn: Queryable, connectionId: string, name: string, excludeId: string | null = null): Promise<number> {
  const { rows } = await conn.query(
    `SELECT COALESCE(MAX(version), 0) AS v
       FROM ${CT.versions}
      WHERE connection_id = ?::uuid AND name = ?
        AND (?::uuid IS NULL OR id <> ?::uuid)`,
    [connectionId, name, excludeId, excludeId]
  );
  return Number(rows[0].v) + 1;
}

async function lockDraft(conn: Queryable, connectionId: string) {
  const { rows } = await conn.query(
    `SELECT * FROM ${CT.versions}
      WHERE connection_id = ?::uuid AND status = 'draft'
      FOR UPDATE`,
    [connectionId]
  );
  return rows[0] || null;
}

async function latestPublishedName(conn: Queryable, connectionId: string) {
  const { rows } = await conn.query(
    `SELECT id, name FROM ${CT.versions}
      WHERE connection_id = ?::uuid AND status = 'published'
      ORDER BY published_at DESC
      LIMIT 1`,
    [connectionId]
  );
  return rows[0] || null;
}

async function insertDraft(
  conn: Queryable,
  { connectionId, companyId, name, version, step, datasetIds, basedOnId, createdBy }: {
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
  const { rows } = await conn.query(
    `INSERT INTO ${CT.versions}
       (id, connection_id, company_id, name, version, status, current_step,
        dataset_ids, based_on_id, created_by)
     VALUES (?::uuid, ?::uuid, ?, ?, ?, 'draft', ?, ?::jsonb, ?::uuid, ?)
     RETURNING *`,
    [crypto.randomUUID(), connectionId, companyId, name, version, step, JSON.stringify(datasetIds), basedOnId, createdBy]
  );
  return rows[0];
}

async function updateDraft(conn: Queryable, draftId: string, sets: string[], params: unknown[]) {
  const { rows } = await conn.query(
    `UPDATE ${CT.versions} SET ${sets.join(', ')} WHERE id = ?::uuid RETURNING *`,
    [...params, draftId]
  );
  return rows[0];
}

async function advanceDraftStep(connectionId: string, steps: readonly string[], step: string) {
  const { rows } = await db.query(
    `UPDATE ${CT.versions}
        SET current_step = CASE
              WHEN COALESCE(array_position(?::text[], current_step::text), 0)
                   < array_position(?::text[], ?::text)
              THEN ? ELSE current_step END,
            updated_at = now()
      WHERE connection_id = ?::uuid AND status = 'draft'
      RETURNING ${COLUMNS}`,
    [steps, steps, step, step, connectionId]
  );
  return rows[0] || null;
}

async function markPublished(
  conn: Queryable,
  draftId: string,
  { name, version, sessionId, snapshot, stats, notifyTeam, datasets, publishedBy }: {
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
  const { rows } = await conn.query(
    `UPDATE ${CT.versions}
        SET name = ?, version = ?, status = 'published', current_step = 'publish',
            session_id = COALESCE(?, session_id),
            object_count = ?, stats = ?::jsonb, snapshot = ?::jsonb, notify_team = ?,
            datasets = ?::jsonb, dataset_ids = COALESCE(?::jsonb, dataset_ids),
            published_by = ?, published_at = now(), updated_at = now()
      WHERE id = ?::uuid
      RETURNING ${COLUMNS}`,
    [
      name,
      version,
      sessionId,
      snapshot.length,
      JSON.stringify(stats),
      JSON.stringify(snapshot),
      Boolean(notifyTeam),
      JSON.stringify(datasets),
      datasets.length ? JSON.stringify(datasets.map((d) => d.id)) : null,
      publishedBy,
      draftId,
    ]
  );
  return rows[0];
}

async function latestPublished(connectionId: string) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM ${CT.versions}
      WHERE connection_id = ?::uuid AND status = 'published'
      ORDER BY published_at DESC
      LIMIT 1`,
    [connectionId]
  );
  return rows[0] || null;
}

async function findPublished(connectionId: string, versionId: unknown) {
  const { rows } = await queryOrNotFound(
    db,
    `SELECT ${COLUMNS}, datasets FROM ${CT.versions}
      WHERE id = ?::uuid AND connection_id = ?::uuid AND status = 'published'`,
    [versionId, connectionId],
    VERSION_NOT_FOUND
  );
  return rows[0] || null;
}

async function deletePublished(conn: Queryable, connectionId: string, versionId: unknown) {
  const { rows } = await queryOrNotFound(
    conn,
    `DELETE FROM ${CT.versions}
      WHERE id = ?::uuid AND connection_id = ?::uuid AND status = 'published'
      RETURNING id, name, version, object_count`,
    [versionId, connectionId],
    VERSION_NOT_FOUND
  );
  return rows[0] || null;
}

async function deleteLegacyPublication(conn: Queryable, connectionId: string, versionId: unknown): Promise<void> {
  await conn.query(
    `DELETE FROM ${CT.publications} WHERE id = ?::uuid AND connection_id = ?::uuid`,
    [versionId, connectionId]
  );
}

async function currentDraft(connectionId: string) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM ${CT.versions}
      WHERE connection_id = ?::uuid AND status = 'draft'`,
    [connectionId]
  );
  return rows[0] || null;
}

async function latestExtraction(connectionId: string) {
  const { rows } = await db.query(
    `SELECT session_id, extraction_mode, extraction_report, extraction_dataset_ids, extracted_at
       FROM ${CT.versions}
      WHERE connection_id = ?::uuid AND extraction_report IS NOT NULL
      ORDER BY extracted_at DESC
      LIMIT 1`,
    [connectionId]
  );
  return rows[0] || null;
}

async function versionExtraction(connectionId: string, versionId: string) {
  const { rows } = await db.query(
    `SELECT session_id, extraction_mode, extraction_report, extraction_dataset_ids, extracted_at
       FROM ${CT.versions}
      WHERE id = ?::uuid AND connection_id = ?::uuid AND extraction_report IS NOT NULL`,
    [versionId, connectionId]
  );
  return rows[0] || null;
}

async function statusHeadlines(connectionIds: readonly string[]) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (connection_id, status)
            connection_id, name, version, status, published_at, updated_at
       FROM ${CT.versions}
      WHERE connection_id = ANY(?::uuid[])
      ORDER BY connection_id, status, COALESCE(published_at, updated_at) DESC`,
    [connectionIds]
  );
  return rows;
}

async function listCompanyPublished(actor: Actor, seeAll: boolean, search?: string | null) {
  const scope = companyScope(actor, 'c.company_id');
  const access = accessColumns(actor);
  const visible = visibleClause(actor, seeAll);
  const where = [`v.status = 'published'`, scope.clause, visible.sql];
  const params: unknown[] = [...access.params, ...scope.params, ...visible.params];
  if (search) {
    where.push('(v.name ILIKE ? OR c.name ILIKE ?)');
    const pattern = likePattern(search);
    params.push(pattern, pattern);
  }

  const { rows } = await db.query(
    `SELECT v.id, v.connection_id, v.name, v.version, v.published_at, v.object_count,
            c.name AS connection_name, c.provider, c.host,
            c.company_id, co.name AS company_name,
            COALESCE(u.display_name, u.username) AS published_by, ${access.sql}
       FROM ${CT.versions} v
       JOIN ${CT.connections} c ON c.id = v.connection_id
       LEFT JOIN ${T.companies} co ON co.id = c.company_id
       LEFT JOIN ${T.users} u ON u.id = v.published_by
      WHERE ${where.join(' AND ')}
      ORDER BY v.connection_id, v.name, v.version DESC`,
    params
  );
  return rows;
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
  deleteLegacyPublication,
  currentDraft,
  latestExtraction,
  versionExtraction,
  statusHeadlines,
  listCompanyPublished,
};
