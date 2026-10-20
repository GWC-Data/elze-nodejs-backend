import config from '../../config';
import * as versionRepository from './versionRepository';
import { fail } from '../../shared/errors/AppError';
import { pageOf } from '../../shared/validation/pagination';
import { requireString } from '../../shared/validation/commonValidator';
import { reviewStatusOf, snapshotEntry } from './contextSerializer';
import { loadObjects, columnSplitter } from './contextService';
import * as versions from './versionService';
import { accessOf, isContextAdmin } from './contextAccessService';
import type { ContextAccess } from './contextAccessService';
import { REVIEW_STATUS, VERSION_STATUS } from '../../shared/db/statuses';
import { MAX_CONTEXTS_PAGE, MAX_SEARCH_LENGTH } from '../../shared/validation/pageLimits';
import type { Tx } from '../../shared/db/database';
import type { Actor } from '../../shared/types/actor';
import type { ObjectRow } from './contextRepository';
import type { PublishedVersion, Version } from './versionSerializer';
import type { SelectedDataset } from './connectionSerializer';
import { datasetFields } from './contextTypes';
import type { DatasetFields, JsonValue, RequestQuery } from './contextTypes';

interface PublishTarget {
  id: string;
  name: string;
  companyId: number;
  selectedDatasets?: readonly SelectedDataset[];
}

interface Blocker {
  id: string;
  severity: string;
  message: string;
  step: string;
}

interface PublishSummary {
  connectionId: string;
  publishedVersion: {
    id: string;
    name: string;
    label: string;
    publishedAt: Date | null;
    publishedBy: number | null;
    objectCount: number;
  } | null;
  suggestedName: string;
  previousVersion: number | null;
  draft: Version | null;
  stats: { id: string; label: string; value: number }[];
  datasets: { id: unknown; name: unknown; tableCount: null }[];
  content: { id: string; label: string; included: boolean }[];
  ready: boolean;
  blockers: Blocker[];
}

interface Publication {
  id: string;
  name: string;
  version: number;
  sessionId: string | null;
  objectCount: number;
  stats: JsonValue;
  publishedBy: number | null;
  publishedAt: Date | null;
}

interface PublishedContextVersion {
  id: string;
  version: number;
  label: string;
  live: boolean;
  publishedAt: Date | null;
  publishedBy: string | null;
  objectCount: number;
}

interface PublishedContext {
  connectionId: string;
  connectionName: string;
  provider: string;
  host: string;
  companyId: number | null;
  companyName: string | null;
  name: string;
  access: ContextAccess | null;
  versions: PublishedContextVersion[];
}

interface PublishResult {
  id: string;
  name: string;
  version: string;
  publishedAt: Date | null;
  objectCount: number;
  status: string;
}

const { withTransaction } = config.database;

function timeOf(value: Date | null): number {
  return new Date(value ?? 0).getTime();
}

function publishable(rows: ObjectRow[]): ObjectRow[] {
  return rows.filter((row) => reviewStatusOf(row) === REVIEW_STATUS.APPROVED);
}

function countByType(rows: ObjectRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.object_type] = (counts[row.object_type] || 0) + 1;
  }
  return counts;
}

function tablesCovered(rows: ObjectRow[], allRows: ObjectRow[] = rows): string[] {
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

async function publishSummary(
  _actor: Actor,
  connection: PublishTarget,
  { version = null }: { version?: PublishedVersion | null } = {}
): Promise<PublishSummary> {
  const rows = version
    ? await loadObjects(connection.id, undefined, { versionId: version.id })
    : await loadObjects(connection.id);
  const selected: readonly DatasetFields[] = version
    ? version.datasets.map(datasetFields)
    : connection.selectedDatasets || [];
  const approved = publishable(rows);
  const pending = rows.filter((row) => reviewStatusOf(row) === REVIEW_STATUS.PENDING);
  const counts = countByType(approved);
  const tables = tablesCovered(approved, rows);

  const stats = [
    { id: 'approved', label: 'Approved facts', value: approved.length },
    { id: 'pending', label: 'Awaiting review', value: pending.length },
    { id: 'datasets', label: 'Datasets', value: selected.length },
    { id: 'tables', label: 'Tables', value: tables.length },
    { id: 'columns', label: 'Columns', value: counts.column_stats || 0 },
    { id: 'joins', label: 'Relationships', value: counts.join || 0 },
    { id: 'transformations', label: 'Transformations', value: counts.transformation || 0 },
    { id: 'metrics', label: 'Metrics', value: counts.metric || 0 },
    { id: 'glossary', label: 'Glossary terms', value: counts.glossary || 0 },
    { id: 'examples', label: 'Examples', value: counts.example || 0 },
  ];

  const blockers: Blocker[] = [];
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

async function validatePublish(
  actor: Actor,
  connection: PublishTarget
): Promise<{ valid: boolean; blockers: Blocker[]; warnings: Blocker[] }> {
  const summary = await publishSummary(actor, connection);
  return {
    valid: summary.blockers.every((blocker) => blocker.severity !== 'blocker'),
    blockers: summary.blockers.filter((b) => b.severity === 'blocker'),
    warnings: summary.blockers.filter((b) => b.severity !== 'blocker'),
  };
}

async function listPublications(connectionId: string): Promise<Publication[]> {
  const state = await versions.versionState({ id: connectionId });
  return state.versions
    .filter((v) => v.status === VERSION_STATUS.PUBLISHED)
    .sort((a, b) => timeOf(b.publishedAt) - timeOf(a.publishedAt))
    .map((v) => ({
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

async function listCompanyPublished(
  actor: Actor,
  query: RequestQuery = {}
): Promise<{ items: PublishedContext[]; total: number; versionCount: number }> {
  const needle = String(query.search || '')
    .trim()
    .slice(0, MAX_SEARCH_LENGTH);
  const rows = await versionRepository.listCompanyPublished(actor, isContextAdmin(actor), needle);

  const groups = new Map<string, PublishedContext>();
  for (const row of rows) {
    const key = `${row.connection_id}\u0000${row.name}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        connectionId: row.connection_id,
        connectionName: row.connection_name,
        provider: row.provider,
        host: row.host,
        companyId: row.company_id === null ? null : Number(row.company_id),
        companyName: row.company_name || null,
        name: row.name,
        access: accessOf(actor, row),
        versions: [],
      };
      groups.set(key, group);
    }
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
    (a, b) => timeOf(b.versions[0].publishedAt) - timeOf(a.versions[0].publishedAt)
  );

  const { offset, pageSize } = pageOf(query, 10, MAX_CONTEXTS_PAGE);

  return {
    items: contexts.slice(offset, offset + pageSize),
    total: contexts.length,
    versionCount: rows.length,
  };
}

async function publishContext(
  actor: Actor,
  connection: PublishTarget,
  { name, notifyTeam = false }: { name?: unknown; notifyTeam?: unknown } = {}
): Promise<PublishResult> {
  const cleanName = requireString(name, 'Context name', { min: 2, max: 120 });

  const rows = await loadObjects(connection.id);
  const approved = publishable(rows);
  if (approved.length === 0) {
    throw fail('VALIDATION_ERROR', 'There is nothing approved to publish. Approve at least one item in Review first.');
  }

  const counts = countByType(approved);
  const snapshot = approved.map(snapshotEntry);

  const published = await withTransaction((conn: Tx) =>
    versions.publishDraft(conn, actor, connection, {
      name: cleanName,
      snapshot,
      datasets: (connection.selectedDatasets || []).map((d) => ({
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

export { publishSummary, validatePublish, publishContext, listPublications, listCompanyPublished };
export type { PublishTarget, Blocker, PublishSummary, Publication, PublishedContext, PublishResult };
