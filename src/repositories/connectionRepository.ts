import config from '../config';
import { CT } from '../models/contextModel';
import { companyScope, queryOrNotFound } from './baseRepository';
import { accessColumns, visibleClause } from './contextAccessRepository';
import type { Queryable } from '../config/pgPool';
import type { Actor } from '../types/actor';

const { db } = config.database;

const COLUMNS = `c.id, c.company_id, c.provider, c.name, c.host, c.secret_hint,
                 c.status, c.last_error, c.last_verified_at, c.created_at`;

const NOT_FOUND = 'Connection not found';

async function listForActor(actor: Actor, seeAll: boolean) {
  const scope = companyScope(actor, 'c.company_id');
  const access = accessColumns(actor);
  const visible = visibleClause(actor, seeAll);
  const { rows } = await db.query(
    `SELECT ${COLUMNS}, ${access.sql},
            (SELECT COUNT(*) FROM ${CT.datasets} d WHERE d.connection_id = c.id) AS "selectedDatasetCount"
       FROM ${CT.connections} c
      WHERE ${scope.clause} AND ${visible.sql}
      ORDER BY c.provider, c.name`,
    [...access.params, ...scope.params, ...visible.params]
  );
  return rows;
}

async function listPublished(actor: Actor, seeAll: boolean) {
  const scope = companyScope(actor, 'c.company_id');
  const visible = visibleClause(actor, seeAll);
  const { rows } = await db.query(
    `SELECT c.id, c.name
       FROM ${CT.connections} c
      WHERE ${scope.clause} AND ${visible.sql}
        AND EXISTS (SELECT 1 FROM ${CT.versions} v
                     WHERE v.connection_id = c.id AND v.status = 'published')
      ORDER BY c.name, c.id`,
    [...scope.params, ...visible.params]
  );
  return rows;
}

async function listPublishedVersions(actor: Actor, seeAll: boolean) {
  const scope = companyScope(actor, 'c.company_id');
  const visible = visibleClause(actor, seeAll);
  const { rows } = await db.query(
    `SELECT v.id, v.connection_id, c.name AS connection_name, v.name, v.version, v.published_at,
            v.version = MAX(v.version) OVER (PARTITION BY v.connection_id, v.name) AS live
       FROM ${CT.versions} v
       JOIN ${CT.connections} c ON c.id = v.connection_id
      WHERE v.status = 'published' AND ${scope.clause} AND ${visible.sql}
      ORDER BY v.name, c.name, v.connection_id, v.version DESC`,
    [...scope.params, ...visible.params]
  );
  return rows;
}

async function findWithSecret(actor: Actor, id: string) {
  const scope = companyScope(actor, 'c.company_id');
  const access = accessColumns(actor);
  const { rows } = await queryOrNotFound(
    db,
    `SELECT ${COLUMNS}, ${access.sql}, c.secret
       FROM ${CT.connections} c
      WHERE c.id = ? AND ${scope.clause}`,
    [...access.params, id, ...scope.params],
    NOT_FOUND
  );
  return rows[0] || null;
}

async function findId(actor: Actor, id: string) {
  const scope = companyScope(actor, 'c.company_id');
  const access = accessColumns(actor);
  const { rows } = await queryOrNotFound(
    db,
    `SELECT c.id, c.name, c.company_id, ${access.sql}
       FROM ${CT.connections} c
      WHERE c.id = ? AND ${scope.clause}`,
    [...access.params, id, ...scope.params],
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
       (id, company_id, provider, name, host, secret, secret_hint, status, last_verified_at, created_by,
        general_access)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'connected', now(), ?, 'restricted')`,
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
