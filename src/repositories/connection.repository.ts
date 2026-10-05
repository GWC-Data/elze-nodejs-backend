import config from '../config';
import { CT } from '../models/context.model';
import { companyScope, queryOrNotFound } from './base.repository';
import type { Queryable } from '../config/pgPool';
import type { Actor } from '../types/actor';

const { db } = config.database;

const COLUMNS = `c.id, c.company_id, c.provider, c.name, c.host, c.secret_hint,
                 c.status, c.last_error, c.last_verified_at, c.created_at`;

const NOT_FOUND = 'Connection not found';

async function listForActor(actor: Actor) {
  const scope = companyScope(actor, 'c.company_id');
  const { rows } = await db.query(
    `SELECT ${COLUMNS},
            (SELECT COUNT(*) FROM ${CT.datasets} d WHERE d.connection_id = c.id) AS "selectedDatasetCount"
       FROM ${CT.connections} c
      WHERE ${scope.clause}
      ORDER BY c.provider, c.name`,
    scope.params
  );
  return rows;
}

async function listPublished(actor: Actor) {
  const scope = companyScope(actor, 'c.company_id');
  const { rows } = await db.query(
    `SELECT c.id, c.name
       FROM ${CT.connections} c
      WHERE ${scope.clause}
        AND EXISTS (SELECT 1 FROM ${CT.versions} v
                     WHERE v.connection_id = c.id AND v.status = 'published')
      ORDER BY c.name, c.id`,
    scope.params
  );
  return rows;
}

async function listPublishedVersions(actor: Actor) {
  const scope = companyScope(actor, 'c.company_id');
  const { rows } = await db.query(
    `SELECT v.id, v.connection_id, c.name AS connection_name, v.name, v.version, v.published_at,
            v.version = MAX(v.version) OVER (PARTITION BY v.connection_id, v.name) AS live
       FROM ${CT.versions} v
       JOIN ${CT.connections} c ON c.id = v.connection_id
      WHERE v.status = 'published' AND ${scope.clause}
      ORDER BY v.name, c.name, v.connection_id, v.version DESC`,
    scope.params
  );
  return rows;
}

async function findWithSecret(actor: Actor, id: string) {
  const scope = companyScope(actor, 'c.company_id');
  const { rows } = await queryOrNotFound(
    db,
    `SELECT ${COLUMNS}, c.secret
       FROM ${CT.connections} c
      WHERE c.id = ? AND ${scope.clause}`,
    [id, ...scope.params],
    NOT_FOUND
  );
  return rows[0] || null;
}

async function findId(actor: Actor, id: string) {
  const scope = companyScope(actor, 'c.company_id');
  const { rows } = await queryOrNotFound(
    db,
    `SELECT c.id FROM ${CT.connections} c WHERE c.id = ? AND ${scope.clause}`,
    [id, ...scope.params],
    NOT_FOUND
  );
  return rows[0] || null;
}

async function selectedDatasets(connectionId: string) {
  const { rows } = await db.query(
    `SELECT dataset_id, name, row_count, column_count, selected_at
       FROM ${CT.datasets}
      WHERE connection_id = ?
      ORDER BY name NULLS LAST, dataset_id`,
    [connectionId]
  );
  return rows;
}

async function insert({ id, companyId, provider, name, host, secret, secretHint, createdBy }: {
  id: string;
  companyId: number | null;
  provider: string;
  name: string;
  host: string | null;
  secret: string;
  secretHint: string | null;
  createdBy: number | null;
}): Promise<void> {
  await db.query(
    `INSERT INTO ${CT.connections}
       (id, company_id, provider, name, host, secret, secret_hint, status, last_verified_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'connected', now(), ?)`,
    [id, companyId, provider, name, host, secret, secretHint, createdBy]
  );
}

async function markStatus(id: string, status: string, lastError: string | null): Promise<void> {
  await db.query(
    `UPDATE ${CT.connections}
        SET status = ?, last_error = ?, last_verified_at = CASE WHEN ? = 'connected' THEN now() ELSE last_verified_at END
      WHERE id = ?`,
    [status, lastError, status, id]
  );
}

async function replaceSelection(
  connectionId: string,
  datasets: readonly { id: string; name?: string | null; rowCount?: number | null; columnCount?: number | null }[],
  selectedBy: number | null
): Promise<void> {
  await db.transaction(async (conn: Queryable) => {
    await conn.query(`DELETE FROM ${CT.datasets} WHERE connection_id = ?`, [connectionId]);
    for (const dataset of datasets) {
      await conn.query(
        `INSERT INTO ${CT.datasets}
           (connection_id, dataset_id, name, row_count, column_count, selected_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [connectionId, dataset.id, dataset.name, dataset.rowCount, dataset.columnCount, selectedBy]
      );
    }
  });
}

async function remove(id: string): Promise<void> {
  await db.query(`DELETE FROM ${CT.connections} WHERE id = ?`, [id]);
}

export {
  listForActor,
  listPublished,
  listPublishedVersions,
  findWithSecret,
  findId,
  selectedDatasets,
  insert,
  markStatus,
  replaceSelection,
  remove,
};
