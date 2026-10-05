import config from '../config';
import { CT } from '../models/context.model';
import { fail } from '../tools/AppError';
import { likePattern } from '../tools/listQuery';
import { INVALID_TEXT_REPRESENTATION, UNDEFINED_TABLE } from '../constants/pgErrors';
import type { Queryable } from '../config/pgPool';
import type { Actor } from '../types/actor';

const { db, withTransaction } = config.database;

interface SqlSource {
  from: string;
  where: string;
  params: unknown[];
}

const OBJECTS = CT.objects;
const REVIEWS = CT.reviews;

const STATUS_SQL = `COALESCE(r.status, CASE WHEN o.verified THEN 'approved' ELSE 'pending' END)`;

const SNAPSHOT_FACTS = `
  SELECT (e->>'id')::uuid AS id, v.connection_id AS workspace_id, v.session_id,
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

function asMissingStore(err: any): never {
  if (err && err.code === UNDEFINED_TABLE) {
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

function runClause(connectionId: string, sessionId?: string | null): { sql: string; params: unknown[] } {
  if (sessionId) {
    return { sql: 'o.workspace_id = ?::uuid AND o.session_id = ?', params: [connectionId, sessionId] };
  }
  return {
    sql:
      'o.workspace_id = ?::uuid' +
      ` AND o.session_id = (SELECT c2.session_id FROM ${OBJECTS} c2` +
      ' WHERE c2.workspace_id = ?::uuid AND c2.session_id IS NOT NULL' +
      ' ORDER BY c2.created_at DESC LIMIT 1)',
    params: [connectionId, connectionId],
  };
}

function sourceOf(
  connectionId: string,
  { sessionId, versionId }: { sessionId?: string | null; versionId?: string | null } = {}
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
  const run = runClause(connectionId, sessionId);
  return {
    from: `${OBJECTS} o LEFT JOIN ${REVIEWS} r ON r.object_id = o.id`,
    where: run.sql,
    params: run.params,
  };
}

async function loadObjects(
  connectionId: string,
  sessionId?: string | null,
  { types, versionId }: { types?: readonly string[] | null; versionId?: string | null } = {}
) {
  const src = sourceOf(connectionId, { sessionId, versionId });
  let clause = src.where;
  const params = [...src.params];
  if (types && types.length) {
    clause += ' AND o.object_type = ANY(?)';
    params.push(types);
  }

  const { rows } = await db.query(
    `SELECT o.id, o.session_id, o.object_type, o.qualified_name, o.source_type,
            o.verified, o.confidence, o.payload, o.reviewed_by, o.reviewed_at,
            o.created_at, o.updated_at,
            r.status AS review_status, r.note AS review_note,
            r.edited AS review_edited, r.reviewed_at AS review_reviewed_at
       FROM ${src.from}
      WHERE ${clause}
      ORDER BY o.object_type, o.qualified_name`,
    params
  );
  return rows;
}

async function loadObject(connectionId: string, objectId: string) {
  const { rows } = await db.query(
    `SELECT o.id, o.session_id, o.object_type, o.qualified_name, o.source_type,
            o.verified, o.confidence, o.payload, o.reviewed_by, o.reviewed_at,
            o.created_at, o.updated_at,
            r.status AS review_status, r.edited AS review_edited,
            r.reviewed_at AS review_reviewed_at
       FROM ${OBJECTS} o
       LEFT JOIN ${REVIEWS} r ON r.object_id = o.id
      WHERE o.id = ?::uuid AND o.workspace_id = ?::uuid`,
    [objectId, connectionId]
  );
  return rows[0] || null;
}

async function pageObjects(
  connectionId: string,
  { sessionId, versionId, type, status, search }: {
    sessionId?: string | null;
    versionId?: string | null;
    type?: unknown;
    status?: unknown;
    search?: unknown;
  },
  paging: { pageSize: number; offset: number }
) {
  const src = sourceOf(connectionId, { sessionId, versionId });
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
  const needle = String(search || '').trim().slice(0, 100);
  if (needle) {
    where.push('(o.qualified_name ILIKE ? OR o.payload::text ILIKE ?)');
    const pattern = likePattern(needle);
    params.push(pattern, pattern);
  }

  const [pageResult, countResult] = await Promise.all([
    db.query(
      `SELECT o.id, o.session_id, o.object_type, o.qualified_name, o.source_type,
              o.verified, o.confidence, o.payload, o.created_at,
              r.status AS review_status, r.edited AS review_edited,
              COUNT(*) OVER () AS "__matched"
         FROM ${src.from}
        WHERE ${where.join(' AND ')}
        ORDER BY o.object_type, o.qualified_name, o.id
        LIMIT ? OFFSET ?`,
      [...params, paging.pageSize, paging.offset]
    ),
    db.query(
      `SELECT o.object_type, COUNT(*)::int AS n, MIN(o.session_id) AS session_id
         FROM ${src.from}
        WHERE ${src.where}
        GROUP BY o.object_type
        ORDER BY o.object_type`,
      src.params
    ),
  ]);

  const rows = pageResult.rows;
  const counts: Record<string, number> = {};
  let all = 0;
  for (const row of countResult.rows) {
    counts[row.object_type] = row.n;
    all += row.n;
  }
  let matched = rows.length ? Number(rows[0].__matched) : 0;
  if (!rows.length && paging.offset > 0) {
    const { rows: recount } = await db.query(
      `SELECT COUNT(*)::int AS n FROM ${src.from}
        WHERE ${where.join(' AND ')}`,
      params
    );
    matched = recount[0].n;
  }
  return {
    rows,
    counts,
    all,
    matched,
    sessionId: countResult.rows.length ? countResult.rows[0].session_id : null,
  };
}

async function requireObject(connectionId: string, objectId: string) {
  let rows;
  try {
    ({ rows } = await db.query(
      `SELECT id, object_type, qualified_name, payload, verified
         FROM ${OBJECTS}
        WHERE id = ?::uuid AND workspace_id = ?::uuid`,
      [objectId, connectionId]
    ));
  } catch (err: any) {
    if (err.code === INVALID_TEXT_REPRESENTATION) throw fail('RESOURCE_NOT_FOUND', 'That item does not exist.');
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
  await withTransaction(async (conn: Queryable) => {
    await conn.query(
      `INSERT INTO ${REVIEWS}
         (object_id, connection_id, status, reviewed_by, reviewed_at)
       VALUES (?::uuid, ?::uuid, ?, ?, now())
       ON CONFLICT (object_id) DO UPDATE SET
         status = EXCLUDED.status,
         reviewed_by = EXCLUDED.reviewed_by,
         reviewed_at = EXCLUDED.reviewed_at`,
      [objectId, connectionId, status, actor.id]
    );

    if (verified !== null) {
      await conn.query(
        `UPDATE ${OBJECTS}
            SET verified = ?, reviewed_by = ?, reviewed_at = now(), updated_at = now()
          WHERE id = ?::uuid`,
        [verified, actor.username, objectId]
      );
    }
  });
}

async function mergePayload(connectionId: string, objectId: string, patch: Record<string, any>): Promise<void> {
  await db.query(
    `UPDATE ${OBJECTS}
        SET payload = payload || ?::jsonb,
            updated_at = now()
      WHERE id = ?::uuid AND workspace_id = ?::uuid`,
    [JSON.stringify(patch), objectId, connectionId]
  );
}

async function markEdited(actor: Actor, connectionId: string, objectId: string, status: string): Promise<void> {
  await db.query(
    `INSERT INTO ${REVIEWS}
       (object_id, connection_id, status, edited, reviewed_by, reviewed_at)
     VALUES (?::uuid, ?::uuid, ?, TRUE, ?, now())
     ON CONFLICT (object_id) DO UPDATE SET edited = TRUE`,
    [objectId, connectionId, status, actor.id]
  );
}

async function matchingObjectIds(
  connectionId: string,
  filter: { type?: unknown; status?: unknown; minConfidence?: unknown }
): Promise<string[]> {
  const run = runClause(connectionId);
  const where = [run.sql];
  const params = [...run.params];
  if (filter.type) {
    where.push('o.object_type = ?');
    params.push(String(filter.type));
  }
  if (filter.status) {
    where.push(`${STATUS_SQL} = ?`);
    params.push(String(filter.status));
  }
  if (filter.minConfidence !== undefined && filter.minConfidence !== null) {
    where.push('o.confidence IS NOT NULL AND o.confidence >= ?');
    params.push(Number(filter.minConfidence));
  }

  const { rows } = await db.query(
    `SELECT o.id FROM ${OBJECTS} o LEFT JOIN ${REVIEWS} r ON r.object_id = o.id
      WHERE ${where.join(' AND ')}`,
    params
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
  await withTransaction(async (conn: Queryable) => {
    await conn.query(
      `INSERT INTO ${REVIEWS} (object_id, connection_id, status, reviewed_by, reviewed_at)
       SELECT id, ?::uuid, ?, ?, now() FROM unnest(?::uuid[]) AS id
       ON CONFLICT (object_id) DO UPDATE SET
         status = EXCLUDED.status,
         reviewed_by = EXCLUDED.reviewed_by,
         reviewed_at = EXCLUDED.reviewed_at`,
      [connectionId, status, actor.id, ids]
    );
    if (verified !== null) {
      await conn.query(
        `UPDATE ${OBJECTS}
            SET verified = ?, reviewed_by = ?, reviewed_at = now(), updated_at = now()
          WHERE id = ANY(?::uuid[]) AND workspace_id = ?::uuid`,
        [verified, actor.username, ids, connectionId]
      );
    }
  });
}

export {
  guarded,
  loadObjects,
  loadObject,
  pageObjects,
  requireObject,
  writeDecision,
  mergePayload,
  markEdited,
  matchingObjectIds,
  writeBulkDecision,
};
