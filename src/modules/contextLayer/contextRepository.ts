import config from '../../config';
import { CT } from './contextModel';
import { fail } from '../../shared/errors/AppError';
import { likePattern } from '../../shared/db/listQuery';
import { sqlState } from '../../shared/db/dbError';
import { rawRows, sqlOf } from '../../shared/db/baseRepository';
import { INVALID_TEXT_REPRESENTATION, UNDEFINED_TABLE } from '../../shared/errors/pgErrors';
import type { Actor } from '../../shared/types/actor';
import { strictEntry, entry } from './contextTypes';
import type { JsonValue } from './contextTypes';

const { prisma, withTransaction } = config.database;

interface FactRow {
  id: string;
  object_type: string;
  qualified_name: string;
  source_type: string;
  verified: boolean;
  confidence: number | null;
  payload: JsonValue;
  review_status: string | null;
  review_edited: boolean | null;
}

interface StoredObjectRow extends FactRow {
  version_id: string;
  reviewed_by: string | number | null;
  reviewed_at: Date | null;
  created_at: Date | null;
  updated_at: Date | null;
  review_reviewed_at: Date | null;
}

interface ObjectRow extends StoredObjectRow {
  review_note: string | null;
}

interface PageObjectRow extends FactRow {
  version_id: string;
  created_at: Date | null;
  __matched: number;
}

interface TypeCountRow {
  object_type: string;
  n: number;
  version_id: string | null;
}

interface RequiredObjectRow {
  id: string;
  object_type: string;
  qualified_name: string;
  payload: JsonValue;
  verified: boolean;
}

interface ObjectPage {
  rows: PageObjectRow[];
  counts: Record<string, number>;
  all: number;
  matched: number;
  highConfidence: number | null;
  runVersionId: string | null;
}

interface SqlSource {
  from: string;
  where: string;
  params: unknown[];
}

const OBJECTS = CT.objects;
const REVIEWS = CT.reviews;

const STATUS_SQL = `COALESCE(r.status::text, CASE WHEN o.verified THEN 'approved' ELSE 'pending' END)`;

const SNAPSHOT_FACTS = `
  SELECT (e->>'id')::uuid AS id, v.connection_id AS context_id, v.id AS version_id,
         e->>'objectType' AS object_type, e->>'qualifiedName' AS qualified_name,
         e->>'sourceType' AS source_type, TRUE AS verified,
         (e->>'confidence')::numeric AS confidence,
         COALESCE(e->'payload', '{}'::jsonb) AS payload,
         v.published_by AS reviewed_by, v.published_at AS reviewed_at,
         v.published_at AS created_at, v.published_at AS updated_at,
         COALESCE((e->>'edited')::boolean, FALSE) AS snapshot_edited
    FROM ${CT.versions} v
   CROSS JOIN LATERAL jsonb_array_elements(v.snapshot) e
   WHERE v.id = ?::uuid AND v.connection_id = ?::uuid AND v.status = 'published'`;

function asMissingStore(err: unknown): never {
  if (err && sqlState(err) === UNDEFINED_TABLE) {
    throw fail(
      'SERVICE_UNAVAILABLE',
      'The context store is not set up in this database yet. Run the Context Layer schema first.'
    );
  }
  throw err;
}

async function guarded<R>(work: () => Promise<R>): Promise<R> {
  try {
    return await work();
  } catch (err) {
    return asMissingStore(err);
  }
}

function runClause(connectionId: string, runVersionId?: unknown): { sql: string; params: unknown[] } {
  if (runVersionId) {
    return { sql: 'o.context_id = ?::uuid AND o.version_id = ?::uuid', params: [connectionId, runVersionId] };
  }
  return {
    sql:
      'o.context_id = ?::uuid' +
      ` AND o.version_id = (SELECT c2.version_id FROM ${OBJECTS} c2` +
      ' WHERE c2.context_id = ?::uuid' +
      ' ORDER BY c2.created_at DESC LIMIT 1)',
    params: [connectionId, connectionId],
  };
}

function sourceOf(
  connectionId: string,
  { runVersionId, versionId }: { runVersionId?: unknown; versionId?: unknown } = {}
): SqlSource {
  if (versionId) {
    return {
      from:
        `(${SNAPSHOT_FACTS}) o LEFT JOIN LATERAL (` +
        `SELECT o.id AS object_id, 'approved'::text AS status, NULL::text AS note,` +
        ` o.snapshot_edited AS edited, o.reviewed_at AS reviewed_at) r ON TRUE`,
      where: 'TRUE',
      params: [versionId, connectionId],
    };
  }
  const run = runClause(connectionId, runVersionId);
  return {
    from: `${OBJECTS} o LEFT JOIN ${REVIEWS} r ON r.object_id = o.id`,
    where: run.sql,
    params: run.params,
  };
}

async function loadObjects(
  connectionId: string,
  runVersionId?: string | null,
  { types, versionId }: { types?: readonly string[] | null; versionId?: unknown } = {}
): Promise<ObjectRow[]> {
  const src = sourceOf(connectionId, { runVersionId, versionId });
  let clause = src.where;
  const params = [...src.params];
  if (types?.length) {
    clause += ' AND o.object_type = ANY(?)';
    params.push(types);
  }

  return rawRows<ObjectRow>(
    prisma,
    sqlOf(
      `SELECT o.id, o.version_id, o.object_type, o.qualified_name, o.source_type,
              o.verified, o.confidence, o.payload, o.reviewed_by, o.reviewed_at,
              o.created_at, o.updated_at,
              r.status AS review_status, r.note AS review_note,
              r.edited AS review_edited, r.reviewed_at AS review_reviewed_at
         FROM ${src.from}
        WHERE ${clause}
        ORDER BY o.object_type, o.qualified_name`,
      params
    )
  );
}

async function loadObject(connectionId: string, objectId: string): Promise<StoredObjectRow | null> {
  const rows = await rawRows<StoredObjectRow>(
    prisma,
    sqlOf(
      `SELECT o.id, o.version_id, o.object_type, o.qualified_name, o.source_type,
              o.verified, o.confidence, o.payload, o.reviewed_by, o.reviewed_at,
              o.created_at, o.updated_at,
              r.status AS review_status, r.edited AS review_edited,
              r.reviewed_at AS review_reviewed_at
         FROM ${OBJECTS} o
         LEFT JOIN ${REVIEWS} r ON r.object_id = o.id
        WHERE o.id = ?::uuid AND o.context_id = ?::uuid`,
      [objectId, connectionId]
    )
  );
  return rows[0] || null;
}

function confidenceFloor(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const floor = Number(value);
  return Number.isFinite(floor) ? floor : null;
}

async function pageObjects(
  connectionId: string,
  {
    runVersionId,
    versionId,
    type,
    status,
    search,
    minConfidence,
    highConfidenceAt,
  }: {
    runVersionId?: unknown;
    versionId?: unknown;
    type?: unknown;
    status?: unknown;
    search?: unknown;
    minConfidence?: unknown;
    highConfidenceAt?: unknown;
  },
  paging: { pageSize: number; offset: number }
): Promise<ObjectPage> {
  const src = sourceOf(connectionId, { runVersionId, versionId });
  const where = [src.where];
  const params = [...src.params];
  if (type) {
    where.push('o.object_type = ?');
    params.push(String(type));
  }
  if (status) {
    where.push(`${STATUS_SQL} = ?`);
    params.push(String(status));
  }
  const floor = confidenceFloor(minConfidence);
  if (floor !== null) {
    where.push('o.confidence IS NOT NULL AND o.confidence >= ?');
    params.push(floor);
  }
  const needle = String(search || '')
    .trim()
    .slice(0, 100);
  if (needle) {
    where.push('(o.qualified_name ILIKE ? OR o.payload::text ILIKE ?)');
    const pattern = likePattern(needle);
    params.push(pattern, pattern);
  }

  const highConfidenceQuery =
    highConfidenceAt === undefined
      ? Promise.resolve(null)
      : rawRows<{ n: number }>(
          prisma,
          sqlOf(
            `SELECT COUNT(*)::int AS n
               FROM ${src.from}
              WHERE ${src.where}${type ? ' AND o.object_type = ?' : ''}
                AND ${STATUS_SQL} = 'pending'
                AND o.confidence IS NOT NULL AND o.confidence >= ?`,
            [...src.params, ...(type ? [String(type)] : []), highConfidenceAt]
          )
        );

  const [rows, countRows, highConfidenceRows] = await Promise.all([
    rawRows<PageObjectRow>(
      prisma,
      sqlOf(
        `SELECT o.id, o.version_id, o.object_type, o.qualified_name, o.source_type,
                o.verified, o.confidence, o.payload, o.created_at,
                r.status AS review_status, r.edited AS review_edited,
                COUNT(*) OVER () AS "__matched"
           FROM ${src.from}
          WHERE ${where.join(' AND ')}
          ORDER BY o.object_type, o.qualified_name, o.id
          LIMIT ? OFFSET ?`,
        [...params, paging.pageSize, paging.offset]
      )
    ),
    rawRows<TypeCountRow>(
      prisma,
      sqlOf(
        `SELECT o.object_type, COUNT(*)::int AS n, MIN(o.version_id::text) AS version_id
           FROM ${src.from}
          WHERE ${src.where}
          GROUP BY o.object_type
          ORDER BY o.object_type`,
        src.params
      )
    ),
    highConfidenceQuery,
  ]);

  const counts: Record<string, number> = {};
  let all = 0;
  for (const row of countRows) {
    counts[row.object_type] = row.n;
    all += row.n;
  }
  let matched = rows.length ? Number(rows[0].__matched) : 0;
  if (!rows.length && paging.offset > 0) {
    const recount = await rawRows<{ n: number }>(
      prisma,
      sqlOf(
        `SELECT COUNT(*)::int AS n FROM ${src.from}
          WHERE ${where.join(' AND ')}`,
        params
      )
    );
    matched = recount[0].n;
  }
  return {
    rows,
    counts,
    all,
    matched,
    highConfidence: highConfidenceRows ? Number(highConfidenceRows[0].n) : null,
    runVersionId: countRows.length ? countRows[0].version_id : null,
  };
}

async function factTotals(connectionIds: readonly string[]): Promise<{ factsGenerated: number; factsPending: number }> {
  if (connectionIds.length === 0) return { factsGenerated: 0, factsPending: 0 };
  const rows = await rawRows<{ generated: number; pending: number }>(
    prisma,
    sqlOf(
      `WITH latest AS (
         SELECT DISTINCT ON (o.context_id) o.context_id, o.version_id
           FROM ${OBJECTS} o
          WHERE o.context_id = ANY(?::uuid[])
          ORDER BY o.context_id, o.created_at DESC
       )
       SELECT COUNT(*)::int AS generated,
              (COUNT(*) FILTER (WHERE ${STATUS_SQL} = 'pending'))::int AS pending
         FROM ${OBJECTS} o
         JOIN latest l ON l.context_id = o.context_id AND l.version_id = o.version_id
         LEFT JOIN ${REVIEWS} r ON r.object_id = o.id`,
      [[...connectionIds]]
    )
  );
  return { factsGenerated: Number(rows[0]?.generated ?? 0), factsPending: Number(rows[0]?.pending ?? 0) };
}

async function requireObject(connectionId: string, objectId: string): Promise<RequiredObjectRow> {
  let rows: RequiredObjectRow[] = [];
  try {
    rows = await rawRows<RequiredObjectRow>(
      prisma,
      sqlOf(
        `SELECT id, object_type, qualified_name, payload, verified
           FROM ${OBJECTS}
          WHERE id = ?::uuid AND context_id = ?::uuid`,
        [objectId, connectionId]
      )
    );
  } catch (err) {
    if (sqlState(err) === INVALID_TEXT_REPRESENTATION) throw fail('RESOURCE_NOT_FOUND', 'That item does not exist.');
    asMissingStore(err);
  }
  if (!rows[0]) throw fail('RESOURCE_NOT_FOUND', 'That item does not exist.');
  return rows[0];
}

async function writeDecision(
  actor: Actor,
  connectionId: string,
  objectId: string,
  status: string,
  verified: boolean | null
): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.$executeRaw(
      sqlOf(
        `INSERT INTO ${REVIEWS}
           (object_id, connection_id, status, reviewed_by, reviewed_at)
         VALUES (?::uuid, ?::uuid, ?, ?, now())
         ON CONFLICT (object_id) DO UPDATE SET
           status = EXCLUDED.status,
           reviewed_by = EXCLUDED.reviewed_by,
           reviewed_at = EXCLUDED.reviewed_at`,
        [objectId, connectionId, status, actor.id]
      )
    );

    if (verified !== null) {
      await tx.$executeRaw(
        sqlOf(
          `UPDATE ${OBJECTS}
              SET verified = ?, reviewed_by = ?, reviewed_at = now(), updated_at = now()
            WHERE id = ?::uuid`,
          [verified, actor.username, objectId]
        )
      );
    }
  });
}

async function mergePayload(connectionId: string, objectId: string, patch: Record<string, unknown>): Promise<void> {
  await prisma.$executeRaw(
    sqlOf(
      `UPDATE ${OBJECTS}
          SET payload = payload || ?::jsonb,
              updated_at = now()
        WHERE id = ?::uuid AND context_id = ?::uuid`,
      [JSON.stringify(patch), objectId, connectionId]
    )
  );
}

async function markEdited(actor: Actor, connectionId: string, objectId: string, status: string): Promise<void> {
  await prisma.$executeRaw(
    sqlOf(
      `INSERT INTO ${REVIEWS}
         (object_id, connection_id, status, edited, reviewed_by, reviewed_at)
       VALUES (?::uuid, ?::uuid, ?, TRUE, ?, now())
       ON CONFLICT (object_id) DO UPDATE SET edited = TRUE`,
      [objectId, connectionId, status, actor.id]
    )
  );
}

async function matchingObjectIds(connectionId: string, filter: unknown): Promise<string[]> {
  const run = runClause(connectionId);
  const where = [run.sql];
  const params = [...run.params];
  const type = strictEntry(filter, 'type');
  const status = entry(filter, 'status');
  const minConfidence = entry(filter, 'minConfidence');
  if (type) {
    where.push('o.object_type = ?');
    params.push(String(type));
  }
  if (status) {
    where.push(`${STATUS_SQL} = ?`);
    params.push(String(status));
  }
  if (minConfidence !== undefined && minConfidence !== null) {
    where.push('o.confidence IS NOT NULL AND o.confidence >= ?');
    params.push(Number(minConfidence));
  }

  const rows = await rawRows<{ id: string }>(
    prisma,
    sqlOf(
      `SELECT o.id FROM ${OBJECTS} o LEFT JOIN ${REVIEWS} r ON r.object_id = o.id
        WHERE ${where.join(' AND ')}`,
      params
    )
  );
  return rows.map((r) => r.id);
}

async function writeBulkDecision(
  actor: Actor,
  connectionId: string,
  ids: readonly string[],
  status: string,
  verified: boolean | null
): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.$executeRaw(
      sqlOf(
        `INSERT INTO ${REVIEWS} (object_id, connection_id, status, reviewed_by, reviewed_at)
         SELECT id, ?::uuid, ?, ?, now() FROM unnest(?::uuid[]) AS id
         ON CONFLICT (object_id) DO UPDATE SET
           status = EXCLUDED.status,
           reviewed_by = EXCLUDED.reviewed_by,
           reviewed_at = EXCLUDED.reviewed_at`,
        [connectionId, status, actor.id, [...ids]]
      )
    );
    if (verified !== null) {
      await tx.$executeRaw(
        sqlOf(
          `UPDATE ${OBJECTS}
              SET verified = ?, reviewed_by = ?, reviewed_at = now(), updated_at = now()
            WHERE id = ANY(?::uuid[]) AND context_id = ?::uuid`,
          [verified, actor.username, [...ids], connectionId]
        )
      );
    }
  });
}

export {
  guarded,
  loadObjects,
  loadObject,
  pageObjects,
  factTotals,
  requireObject,
  writeDecision,
  mergePayload,
  markEdited,
  matchingObjectIds,
  writeBulkDecision,
};
export type { FactRow, StoredObjectRow, ObjectRow, PageObjectRow, RequiredObjectRow, ObjectPage };
