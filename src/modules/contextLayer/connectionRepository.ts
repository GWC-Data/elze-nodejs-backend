import config from '../../config';
import { Prisma } from '../../generated/prisma/client';
import { companyScope, orNotFound, rawRows } from '../../shared/db/baseRepository';
import { accessColumns, visibleClause } from './contextAccessRepository';
import type { AccessColumnsRow } from './contextAccessRepository';
import { likePattern } from '../../shared/db/listQuery';
import type { Actor } from '../../shared/types/actor';
import type { ConnectionStatus, ContextStep } from '../../generated/prisma/enums';

const { prisma, withTransaction } = config.database;

interface ConnectionRow extends AccessColumnsRow {
  id: string;
  company_id: number;
  provider: string;
  name: string;
  host: string;
  secret_hint: string;
  status: ConnectionStatus;
  last_error: string | null;
  last_verified_at: Date | null;
  created_at: Date;
}

interface ListedConnectionRow extends ConnectionRow {
  selectedDatasetCount: number;
}

interface DraftConnectionRow extends ListedConnectionRow {
  draft_name: string | null;
  draft_version: number | null;
  draft_step: ContextStep | null;
  draft_updated_at: Date | null;
}

interface ConnectionSecretRow extends ConnectionRow {
  secret: string;
}

interface ConnectionIdRow extends AccessColumnsRow {
  id: string;
  name: string;
  company_id: number;
}

interface PublishedConnectionRow {
  id: string;
  name: string;
}

interface PublishedVersionOptionRow {
  id: string;
  connection_id: string;
  connection_name: string;
  name: string;
  version: number;
  published_at: Date | null;
  live: boolean;
}

interface SelectedDatasetRow {
  dataset_id: string;
  name: string | null;
  row_count: number | null;
  column_count: number | null;
  selected_at: Date;
}

const COLUMNS = Prisma.sql`c.id, c.company_id, c.provider, c.name, c.host, c.secret_hint,
                 c.status, c.last_error, c.last_verified_at, c.created_at`;

const NOT_FOUND = 'Connection not found';

async function listForActor(actor: Actor, seeAll: boolean): Promise<ListedConnectionRow[]> {
  return rawRows<ListedConnectionRow>(
    prisma,
    Prisma.sql`SELECT ${COLUMNS}, ${accessColumns(actor)},
            (SELECT COUNT(*) FROM datasets d WHERE d.connection_id = c.id) AS "selectedDatasetCount"
       FROM connections c
      WHERE ${companyScope(actor, 'c.company_id')} AND ${visibleClause(actor, seeAll)}
      ORDER BY c.provider, c.name`
  );
}

async function listDrafts(
  actor: Actor,
  seeAll: boolean,
  { search, offset, limit }: { search: string; offset: number; limit: number }
): Promise<{ rows: DraftConnectionRow[]; total: number }> {
  const conditions = [
    companyScope(actor, 'c.company_id'),
    visibleClause(actor, seeAll),
    Prisma.sql`(d.id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM context_layer_versions p
                                        WHERE p.connection_id = c.id AND p.status = 'published'))`,
  ];
  if (search) {
    const pattern = likePattern(search);
    conditions.push(Prisma.sql`(c.name ILIKE ${pattern} OR d.name ILIKE ${pattern})`);
  }
  const from = Prisma.sql`FROM connections c
       LEFT JOIN context_layer_versions d ON d.connection_id = c.id AND d.status = 'draft'
      WHERE ${Prisma.join(conditions, ' AND ')}`;

  const [{ n }] = await rawRows<{ n: number }>(prisma, Prisma.sql`SELECT COUNT(*)::int AS n ${from}`);
  const rows = await rawRows<DraftConnectionRow>(
    prisma,
    Prisma.sql`SELECT ${COLUMNS}, ${accessColumns(actor)},
            (SELECT COUNT(*) FROM datasets ds WHERE ds.connection_id = c.id) AS "selectedDatasetCount",
            d.name AS draft_name, d.version AS draft_version, d.current_step AS draft_step,
            d.updated_at AS draft_updated_at
       ${from}
      ORDER BY COALESCE(d.updated_at, c.created_at) DESC, c.name
      LIMIT ${limit} OFFSET ${offset}`
  );
  return { rows, total: n };
}

async function listPublished(actor: Actor, seeAll: boolean): Promise<PublishedConnectionRow[]> {
  return rawRows<PublishedConnectionRow>(
    prisma,
    Prisma.sql`SELECT c.id, c.name
       FROM connections c
      WHERE ${companyScope(actor, 'c.company_id')} AND ${visibleClause(actor, seeAll)}
        AND EXISTS (SELECT 1 FROM context_layer_versions v
                     WHERE v.connection_id = c.id AND v.status = 'published')
      ORDER BY c.name, c.id`
  );
}

async function listPublishedVersions(actor: Actor, seeAll: boolean): Promise<PublishedVersionOptionRow[]> {
  return rawRows<PublishedVersionOptionRow>(
    prisma,
    Prisma.sql`SELECT v.id, v.connection_id, c.name AS connection_name, v.name, v.version, v.published_at,
            v.version = MAX(v.version) OVER (PARTITION BY v.connection_id, v.name) AS live
       FROM context_layer_versions v
       JOIN connections c ON c.id = v.connection_id
      WHERE v.status = 'published' AND ${companyScope(actor, 'c.company_id')} AND ${visibleClause(actor, seeAll)}
      ORDER BY v.name, c.name, v.connection_id, v.version DESC`
  );
}

async function findWithSecret(actor: Actor, id: string): Promise<ConnectionSecretRow | null> {
  const rows = await orNotFound(
    rawRows<ConnectionSecretRow>(
      prisma,
      Prisma.sql`SELECT ${COLUMNS}, ${accessColumns(actor)}, c.secret
         FROM connections c
        WHERE c.id = ${id}::uuid AND ${companyScope(actor, 'c.company_id')}`
    ),
    NOT_FOUND
  );
  return rows[0] || null;
}

async function findId(actor: Actor, id: string): Promise<ConnectionIdRow | null> {
  const rows = await orNotFound(
    rawRows<ConnectionIdRow>(
      prisma,
      Prisma.sql`SELECT c.id, c.name, c.company_id, ${accessColumns(actor)}
         FROM connections c
        WHERE c.id = ${id}::uuid AND ${companyScope(actor, 'c.company_id')}`
    ),
    NOT_FOUND
  );
  return rows[0] || null;
}

async function selectedDatasets(connectionId: string): Promise<SelectedDatasetRow[]> {
  const rows = await prisma.dataset.findMany({
    where: { connectionId },
    orderBy: [{ name: { sort: 'asc', nulls: 'last' } }, { datasetId: 'asc' }],
  });
  return rows.map((d) => ({
    dataset_id: d.datasetId,
    name: d.name,
    row_count: d.rowCount === null ? null : Number(d.rowCount),
    column_count: d.columnCount,
    selected_at: d.selectedAt,
  }));
}

async function insert({
  id,
  companyId,
  provider,
  name,
  host,
  secret,
  secretHint,
  createdBy,
}: {
  id: string;
  companyId: number;
  provider: string;
  name: string;
  host: string;
  secret: string;
  secretHint: string;
  createdBy: number | null;
}): Promise<void> {
  await prisma.connection.create({
    data: {
      id,
      companyId,
      provider,
      name,
      host,
      secret,
      secretHint,
      status: 'connected',
      lastVerifiedAt: new Date(),
      createdBy,
      generalAccess: 'restricted',
    },
  });
}

async function markStatus(id: string, status: ConnectionStatus, lastError: string | null): Promise<void> {
  await prisma.connection.updateMany({
    where: { id },
    data: { status, lastError, ...(status === 'connected' ? { lastVerifiedAt: new Date() } : {}) },
  });
}

async function replaceSelection(
  connectionId: string,
  datasets: readonly { id: string; name?: string | null; rowCount?: number | null; columnCount?: number | null }[],
  selectedBy: number | null
): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.dataset.deleteMany({ where: { connectionId } });
    if (!datasets.length) return;
    await tx.dataset.createMany({
      data: datasets.map((dataset) => ({
        connectionId,
        datasetId: dataset.id,
        name: dataset.name ?? null,
        rowCount:
          dataset.rowCount === null || dataset.rowCount === undefined ? null : BigInt(Math.trunc(dataset.rowCount)),
        columnCount: dataset.columnCount ?? null,
        selectedBy,
      })),
    });
  });
}

async function remove(id: string): Promise<void> {
  await prisma.connection.deleteMany({ where: { id } });
}

export {
  listForActor,
  listDrafts,
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
export type {
  ConnectionRow,
  ListedConnectionRow,
  DraftConnectionRow,
  ConnectionSecretRow,
  ConnectionIdRow,
  PublishedConnectionRow,
  PublishedVersionOptionRow,
  SelectedDatasetRow,
};
