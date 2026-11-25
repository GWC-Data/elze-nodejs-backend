import config from '../../config';
import { Prisma } from '../../generated/prisma/client';
import { rawRows } from '../../shared/db/baseRepository';
import { likePattern } from '../../shared/db/listQuery';
import { accessColumns, contextScope, visibleClause } from '../contextLayer/contextAccessRepository';
import type { AccessColumnsRow } from '../contextLayer/contextAccessRepository';
import type { JsonValue } from '../contextLayer/contextTypes';
import type { Actor } from '../../shared/types/actor';
import type { EntryFilter, PageWindow } from './mcpDataValidator';

const { prisma } = config.database;

interface PublishedRow extends AccessColumnsRow {
  id: string;
  connection_id: string;
  name: string;
  version: number;
  published_at: Date | null;
  object_count: number;
  dataset_count: number;
  stats: JsonValue;
  connection_name: string;
  provider: string;
  company_id: string | null;
  company_name: string | null;
  published_by: string | null;
}

interface ContextVersionRow extends PublishedRow {
  datasets: JsonValue;
  business_layer: JsonValue;
  live_version: number;
}

interface VersionListRow {
  version: number;
  published_at: Date | null;
  published_by: string | null;
  object_count: number;
}

const PUBLISHED = Prisma.sql`v.status = 'published' AND v.deleted_at IS NULL`;

const DATASET_COUNT = Prisma.sql`CASE WHEN jsonb_typeof(v.datasets) = 'array' THEN jsonb_array_length(v.datasets) ELSE 0 END`;

const ENTRIES = Prisma.sql`context_layer_versions v
  CROSS JOIN LATERAL jsonb_array_elements(v.snapshot) WITH ORDINALITY AS x(e, i)`;

function summaryColumns(actor: Actor): Prisma.Sql {
  return Prisma.sql`v.id, v.connection_id, v.name, v.version, v.published_at, v.object_count,
          ${DATASET_COUNT} AS dataset_count, v.stats,
          c.name AS connection_name, c.provider, c.company_id, co.name AS company_name,
          COALESCE(u.display_name, u.username) AS published_by, ${accessColumns(actor)}`;
}

const FROM_VERSIONS = Prisma.sql`context_layer_versions v
  JOIN connections c ON c.id = v.connection_id
  LEFT JOIN companies co ON co.id = c.company_id
  LEFT JOIN users u ON u.id = v.published_by`;

async function listPublished(actor: Actor, seeAll: boolean, search: string): Promise<PublishedRow[]> {
  const conditions = [PUBLISHED, visibleClause(actor, seeAll)];
  if (search) {
    const pattern = likePattern(search);
    conditions.push(Prisma.sql`(v.name ILIKE ${pattern} OR c.name ILIKE ${pattern})`);
  }
  return rawRows<PublishedRow>(
    prisma,
    Prisma.sql`SELECT ${summaryColumns(actor)}
       FROM ${FROM_VERSIONS}
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY v.connection_id, v.name, v.version DESC`
  );
}

async function findVersion(
  actor: Actor,
  connectionId: string,
  name: string,
  version: number | null
): Promise<ContextVersionRow | null> {
  const pinned = version === null ? Prisma.empty : Prisma.sql`AND v.version = ${version}`;
  const rows = await rawRows<ContextVersionRow>(
    prisma,
    Prisma.sql`SELECT ${summaryColumns(actor)}, v.datasets, v.business_layer,
            (SELECT MAX(l.version) FROM context_layer_versions l
              WHERE l.connection_id = v.connection_id AND l.name = v.name
                AND l.status = 'published' AND l.deleted_at IS NULL) AS live_version
       FROM ${FROM_VERSIONS}
      WHERE v.connection_id = ${connectionId}::uuid AND v.name = ${name} AND ${PUBLISHED}
        AND c.deleted_at IS NULL AND ${contextScope(actor)} ${pinned}
      ORDER BY v.version DESC
      LIMIT 1`
  );
  return rows[0] ?? null;
}

async function listVersions(connectionId: string, name: string): Promise<VersionListRow[]> {
  return rawRows<VersionListRow>(
    prisma,
    Prisma.sql`SELECT v.version, v.published_at, v.object_count, COALESCE(u.display_name, u.username) AS published_by
       FROM context_layer_versions v
       LEFT JOIN users u ON u.id = v.published_by
      WHERE v.connection_id = ${connectionId}::uuid AND v.name = ${name} AND ${PUBLISHED}
      ORDER BY v.version DESC`
  );
}

function entryWhere(versionId: string, filter: EntryFilter): Prisma.Sql {
  const conditions = [Prisma.sql`v.id = ${versionId}::uuid`];
  if (filter.types) conditions.push(Prisma.sql`x.e->>'objectType' = ANY(${filter.types}::text[])`);
  if (filter.qualifiedName !== null) conditions.push(Prisma.sql`x.e->>'qualifiedName' = ${filter.qualifiedName}`);
  for (const word of filter.words) {
    const pattern = likePattern(word);
    conditions.push(Prisma.sql`((x.e->>'qualifiedName') ILIKE ${pattern} OR (x.e->'payload')::text ILIKE ${pattern})`);
  }
  return Prisma.join(conditions, ' AND ');
}

function entryOrder(filter: EntryFilter): Prisma.Sql {
  if (filter.words.length === 0) return Prisma.sql`x.e->>'objectType', x.e->>'qualifiedName', x.i`;
  const named = Prisma.join(
    filter.words.map((word) => Prisma.sql`(x.e->>'qualifiedName') ILIKE ${likePattern(word)}`),
    ' OR '
  );
  return Prisma.sql`(${named}) DESC, x.e->>'objectType', x.e->>'qualifiedName', x.i`;
}

async function countEntries(versionId: string, filter: EntryFilter): Promise<number> {
  const rows = await rawRows<{ n: number }>(
    prisma,
    Prisma.sql`SELECT COUNT(*)::int AS n FROM ${ENTRIES} WHERE ${entryWhere(versionId, filter)}`
  );
  return rows[0]?.n ?? 0;
}

async function pageEntries(versionId: string, filter: EntryFilter, window: PageWindow): Promise<JsonValue[]> {
  const rows = await rawRows<{ entry: JsonValue }>(
    prisma,
    Prisma.sql`SELECT x.e AS entry FROM ${ENTRIES}
      WHERE ${entryWhere(versionId, filter)}
      ORDER BY ${entryOrder(filter)}
      OFFSET ${window.offset} LIMIT ${window.limit}`
  );
  return rows.map((row) => row.entry);
}

export { listPublished, findVersion, listVersions, countEntries, pageEntries };
export type { PublishedRow, ContextVersionRow, VersionListRow };
