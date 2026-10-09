import config from '../config';
import * as versionRepository from '../repositories/versionRepository';
import { fail } from '../tools/AppError';
import { pageOf } from '../tools/pagination';
import { requireString } from '../validators/commonValidator';
import { reviewStatusOf, snapshotEntry } from '../views/serializers/contextSerializer';
import { loadObjects, columnSplitter } from './contextService';
import * as versions from './versionService';
import { accessOf, isContextAdmin } from './contextAccessService';
import { REVIEW_STATUS, VERSION_STATUS } from '../constants/statuses';
import { MAX_CONTEXTS_PAGE, MAX_SEARCH_LENGTH } from '../constants/pagination';
import type { Queryable } from '../config/pgPool';
import type { Actor } from '../types/actor';

const { withTransaction } = config.database;

type Row = Record<string, any>;
type Connection = Record<string, any>;

function publishable(rows: Row[]): Row[] {
  return rows.filter((row) => reviewStatusOf(row) === REVIEW_STATUS.APPROVED);
}

function countByType(rows: Row[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.object_type] = (counts[row.object_type] || 0) + 1;
  }
  return counts;
}

function tablesCovered(rows: Row[], allRows: Row[] = rows): string[] {
  const split = columnSplitter(allRows);
  const names = new Set<string>();
  for (const row of rows) {
    if (row.object_type === 'table') names.add(row.qualified_name);
    else if (row.object_type === 'column_stats') {
      const { table } = split(row.qualified_name);
      if (table) names.add(table);
    }
  }
  return [...names];
}

async function publishSummary(actor: Actor, connection: Connection, { version = null }: { version?: Record<string, any> | null } = {}): Promise<Record<string, any>> {
  const rows = version
    ? await loadObjects(connection.id, undefined, { versionId: version.id })
    : await loadObjects(connection.id);
  const selected: any[] = version ? version.datasets : connection.selectedDatasets || [];
  const approved = publishable(rows);
  const pending = rows.filter((row) => reviewStatusOf(row) === REVIEW_STATUS.PENDING);
  const counts = countByType(approved);
  const tables = tablesCovered(approved, rows);

  const stats = [
    { id: 'datasets', label: 'Datasets', value: selected.length },
    { id: 'tables', label: 'Tables', value: tables.length },
    { id: 'columns', label: 'Columns', value: counts.column_stats || 0 },
    { id: 'joins', label: 'Relationships', value: counts.join || 0 },
    { id: 'transformations', label: 'Transformations', value: counts.transformation || 0 },
    { id: 'metrics', label: 'Metrics', value: counts.metric || 0 },
    { id: 'glossary', label: 'Glossary terms', value: counts.glossary || 0 },
    { id: 'examples', label: 'Examples', value: counts.example || 0 },
  ];

  const blockers: Record<string, any>[] = [];
  if (!version && approved.length === 0) {
    blockers.push({
      id: 'nothing-approved',
      severity: 'blocker',
      message:
        rows.length === 0
          ? 'No extraction has run for this connection yet.'
          : 'Nothing has been approved yet. Approve at least one item before publishing.',
      step: rows.length === 0 ? 'understand' : 'review',
    });
  }
  if (!version && pending.length > 0) {
    blockers.push({
      id: 'pending-review',
      severity: 'warning',
      message: `${pending.length} item${pending.length === 1 ? '' : 's'} still awaiting review. ${
        pending.length === 1 ? 'It' : 'They'
      } will not be published.`,
      step: 'review',
    });
  }

  const [previous, draft] = version
    ? [null, null]
    : await Promise.all([versions.latestPublished(connection.id), versions.currentDraft(connection.id)]);

  return {
    connectionId: connection.id,
    publishedVersion: version
      ? {
          id: version.id,
          name: version.name,
          label: version.label,
          publishedAt: version.publishedAt,
          publishedBy: version.publishedBy,
          objectCount: version.objectCount,
        }
      : null,
    suggestedName: version ? version.name : draft ? draft.name : previous ? previous.name : connection.name,
    previousVersion: version ? version.version : previous ? previous.version : null,
    draft,
    stats,
    datasets: selected.map((dataset) => ({
      id: dataset.id,
      name: dataset.name || dataset.id,
      tableCount: null,
    })),
    content: [
      { id: 'tables', label: 'Table descriptions', included: (counts.table || 0) > 0 },
      { id: 'columns', label: 'Column statistics and descriptions', included: (counts.column_stats || 0) > 0 },
      { id: 'joins', label: 'Table relationships', included: (counts.join || 0) > 0 },
      { id: 'transformations', label: 'Lineage and transformations', included: (counts.transformation || 0) > 0 },
      { id: 'metrics', label: 'Metrics', included: (counts.metric || 0) > 0 },
      { id: 'glossary', label: 'Glossary terms', included: (counts.glossary || 0) > 0 },
      { id: 'examples', label: 'Example queries and cards', included: (counts.example || 0) > 0 },
    ],
    ready: !version && approved.length > 0,
    blockers,
  };
}

async function validatePublish(actor: Actor, connection: Connection): Promise<Record<string, any>> {
  const summary = await publishSummary(actor, connection);
  return {
    valid: summary.blockers.every((blocker: any) => blocker.severity !== 'blocker'),
    blockers: summary.blockers.filter((b: any) => b.severity === 'blocker'),
    warnings: summary.blockers.filter((b: any) => b.severity !== 'blocker'),
  };
}

async function listPublications(connectionId: string): Promise<Record<string, any>[]> {
  const state = await versions.versionState({ id: connectionId });
  return state.versions
    .filter((v: any) => v.status === VERSION_STATUS.PUBLISHED)
    .sort((a: any, b: any) => (new Date(b.publishedAt) as any) - (new Date(a.publishedAt) as any))
    .map((v: any) => ({
      id: v.id,
      name: v.name,
      version: v.version,
      sessionId: v.sessionId,
      objectCount: v.objectCount,
      stats: v.stats,
      publishedBy: v.publishedBy,
      publishedAt: v.publishedAt,
    }));
}

async function listCompanyPublished(actor: Actor, query: Record<string, any> = {}): Promise<Record<string, any>> {
  const needle = String(query.search || '').trim().slice(0, MAX_SEARCH_LENGTH);
  const rows = await versionRepository.listCompanyPublished(actor, isContextAdmin(actor), needle);

  const groups = new Map<string, Record<string, any>>();
  for (const row of rows) {
    const key = `${row.connection_id}\u0000${row.name}`;
    if (!groups.has(key)) {
      groups.set(key, {
        connectionId: row.connection_id,
        connectionName: row.connection_name,
        provider: row.provider,
        host: row.host,
        companyId: row.company_id === null ? null : Number(row.company_id),
        companyName: row.company_name || null,
        name: row.name,
        access: accessOf(actor, row),
        versions: [],
      });
    }
    const group = groups.get(key)!;
    group.versions.push({
      id: row.id,
      version: Number(row.version),
      label: `v${row.version}`,
      live: group.versions.length === 0,
      publishedAt: row.published_at,
      publishedBy: row.published_by || null,
      objectCount: Number(row.object_count),
    });
  }

  const contexts = [...groups.values()].sort(
    (a, b) => (new Date(b.versions[0].publishedAt) as any) - (new Date(a.versions[0].publishedAt) as any)
  );

  const { offset, pageSize } = pageOf(query, 10, MAX_CONTEXTS_PAGE);

  return {
    items: contexts.slice(offset, offset + pageSize),
    total: contexts.length,
    versionCount: rows.length,
  };
}

async function publishContext(actor: Actor, connection: Connection, { name, notifyTeam = false }: { name?: unknown; notifyTeam?: boolean } = {}): Promise<Record<string, any>> {
  const cleanName = requireString(name, 'Context name', { min: 2, max: 120 });

  const rows = await loadObjects(connection.id);
  const approved = publishable(rows);
  if (approved.length === 0) {
    throw fail(
      'VALIDATION_ERROR',
      'There is nothing approved to publish. Approve at least one item in Review first.'
    );
  }

  const counts = countByType(approved);
  const snapshot = approved.map(snapshotEntry);

  const published = await withTransaction((conn: Queryable) =>
    versions.publishDraft(conn, actor, connection, {
      name: cleanName,
      snapshot,
      datasets: (connection.selectedDatasets || []).map((d: any) => ({
        id: d.id,
        name: d.name,
        rowCount: d.rowCount,
        columnCount: d.columnCount,
        selectedAt: d.selectedAt,
      })),
      stats: { counts, tables: tablesCovered(approved, rows) },
      sessionId: null,
      notifyTeam,
    })
  );

  return {
    id: published.id,
    name: published.name,
    version: published.label,
    publishedAt: published.publishedAt,
    objectCount: published.objectCount,
    status: VERSION_STATUS.PUBLISHED,
  };
}

export {
  publishSummary,
  validatePublish,
  publishContext,
  listPublications,
  listCompanyPublished,
};
