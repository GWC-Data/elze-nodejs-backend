import * as contextRepository from './contextRepository';
import type { ObjectRow, StoredObjectRow } from './contextRepository';
import { fail } from '../../shared/errors/AppError';
import { pageOf } from '../../shared/validation/pagination';
import { reviewStatusOf, shapeFact, shapeReviewItem, contextObjectItem } from './contextSerializer';
import type { ContextObjectItem, Fact, ReviewItem } from './contextSerializer';
import {
  AI_TEXT_KEYS,
  TERM_TYPES,
  TYPE_LABELS,
  GLOSSARY_FILTERS,
  CONFIDENT,
  HIGH_CONFIDENCE,
  TERM_ORDER,
} from './contextConstants';
import { REVIEW_STATUS, REVIEW_DECISIONS, REVIEW_DECISION_STATUS } from '../../shared/db/statuses';
import type { Actor } from '../../shared/types/actor';
import { entry, field, jsonList } from './contextTypes';
import type { DatasetFields, JsonValue, RequestQuery } from './contextTypes';

interface SnapshotColumn {
  name: JsonValue | undefined;
  dataType: JsonValue;
  nullable: null;
  nullPercent: number | null;
  uniqueCount: number | null;
  semanticType: null;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  min: JsonValue;
  max: JsonValue;
  distribution: null;
}

interface SnapshotTableProfile {
  id: unknown;
  datasetId: unknown;
  name: unknown;
  description: string | null;
  rowCount: unknown;
  columnCount: unknown;
  sizeBytes: null;
  qualityScore: null;
  lastRefreshedAt: null;
  owner: null;
  columns: SnapshotColumn[];
  sample: null;
  statsSampleSize: null;
  qualityIssues: unknown[];
}

interface ContextObjectList {
  resolvedVersionId: string | null;
  count: number;
  counts: Record<string, number>;
  matched: number;
  objects: ContextObjectItem[];
}

interface TableGroup {
  table: ObjectRow;
  columns: ObjectRow[];
  related: ObjectRow[];
}

interface TableView {
  resolvedVersionId: string | null;
  count: number;
  counts: Record<string, number>;
  needsReview: number;
  reviewCounts: { tables: number; columns: number };
  tableCount: number;
  matched: number;
  tables: { table: Fact; columns: Fact[]; related: Fact[]; needsReview: number }[];
  unattached: Fact[];
}

interface ReviewQueue {
  items: ReviewItem[];
  counts: Record<string, number>;
  total: number;
  matched: number;
  highConfidence: { threshold: number; pending: number };
}

interface Term {
  id: string;
  term: string;
  type: string;
  typeLabel: string;
  definition: string | null;
  appliesTo: string | null;
  confidence: number | null;
  state: string;
  objectType: string;
  qualifiedName: string;
  reviewedAt: Date | null;
}

interface GlossaryStats {
  termsGenerated: number;
  entityCount: number;
  metricCount: number;
  dimensionCount: number;
  averageConfidence: number | null;
  humanApproved: number;
  approvedThisWeek: number;
}

interface Understanding {
  matched: number;
  stats: GlossaryStats;
  terms: Pick<Term, 'id' | 'term' | 'typeLabel' | 'definition' | 'appliesTo' | 'confidence' | 'state'>[];
}

const { loadObjects, guarded } = contextRepository;

const identifierKey = (name: unknown): string =>
  String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

function keyColumns(primaryKey: unknown): ReadonlySet<unknown> {
  return new Set(
    String(primaryKey || '')
      .split(/[,()]+/)
      .map((t) => t.trim())
      .filter(Boolean)
  );
}

function foreignKeyColumns(payload: JsonValue): ReadonlySet<unknown> {
  return new Set(jsonList(field(payload, 'foreign_keys')).map((fk) => field(fk, 'column')));
}

function columnSplitter(
  rows: readonly Pick<ObjectRow, 'object_type' | 'qualified_name'>[]
): (qualifiedName: unknown) => { table: string | null; column: string } {
  const tables: string[] = rows
    .filter((row) => row.object_type === 'table')
    .map((row) => row.qualified_name)
    .sort((a, b) => b.length - a.length);

  return (qualifiedName: unknown) => {
    const name = String(qualifiedName || '');
    const table = tables.find((t) => name.startsWith(`${t}.`) && name.length > t.length + 1);
    if (table) return { table, column: name.slice(table.length + 1) };
    const index = name.lastIndexOf('.');
    return index === -1
      ? { table: null, column: name }
      : { table: name.slice(0, index), column: name.slice(index + 1) };
  };
}

async function listContextObjects(connectionId: string, query: RequestQuery = {}): Promise<ContextObjectList> {
  const result = await guarded(() =>
    contextRepository.pageObjects(
      connectionId,
      { ...query, versionId: query.version, status: undefined },
      pageOf(query, 25)
    )
  );
  return {
    resolvedVersionId: result.runVersionId,
    count: result.all,
    counts: result.counts,
    matched: result.matched,
    objects: result.rows.map(contextObjectItem),
  };
}

function numberFrom(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const m = value.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  const scale = /\d\s*[kK]\b/.test(value) ? 1e3 : /\d\s*M\b/.test(value) ? 1e6 : /\d\s*[bB]\b/.test(value) ? 1e9 : 1;
  return n * scale;
}

async function snapshotTableProfile(
  connectionId: string,
  versionId: string | null | undefined,
  dataset: DatasetFields
): Promise<SnapshotTableProfile> {
  const rows = await loadObjects(connectionId, undefined, { versionId });
  const tables = rows.filter((r) => r.object_type === 'table');
  const wanted = [dataset.id, dataset.name].filter(Boolean).map(identifierKey);
  const table =
    tables.find((t) => {
      const p = t.payload || {};
      return (
        wanted.includes(identifierKey(t.qualified_name)) ||
        [field(p, 'dataset_id'), field(p, 'datasetId')].filter(Boolean).map(String).includes(String(dataset.id))
      );
    }) || (tables.length === 1 ? tables[0] : null);

  const payload: JsonValue = table?.payload || {};
  const split = columnSplitter(rows);
  const stats = new Map<string, JsonValue>();
  if (table) {
    for (const row of rows) {
      if (row.object_type !== 'column_stats') continue;
      const { table: owner, column } = split(row.qualified_name);
      if (owner === table.qualified_name) stats.set(column, row.payload || {});
    }
  }
  const statsByName: ReadonlyMap<unknown, JsonValue> = stats;
  const declared = jsonList(field(payload, 'columns'));
  const names = [
    ...new Set<JsonValue | undefined>([...declared.map((c) => field(c, 'name')).filter(Boolean), ...stats.keys()]),
  ];
  const keyTokens = keyColumns(field(payload, 'primary_key'));
  const foreign = foreignKeyColumns(payload);

  const columns = names.map((name) => {
    const stat = statsByName.get(name) || {};
    const decl = declared.find((c) => c && field(c, 'name') === name) || {};
    return {
      name,
      dataType: field(stat, 'data_type') || field(decl, 'type') || 'unknown',
      nullable: null,
      nullPercent: numberFrom(field(stat, 'null_rate')),
      uniqueCount: numberFrom(field(stat, 'distinct_count_est') ?? field(stat, 'distinct_values')),
      semanticType: null,
      isPrimaryKey: keyTokens.has(name),
      isForeignKey: foreign.has(name),
      min: field(stat, 'min') ?? null,
      max: field(stat, 'max') ?? null,
      distribution: null,
    };
  });

  const description = field(payload, 'description');
  return {
    id: dataset.id,
    datasetId: dataset.id,
    name: dataset.name || (table ? table.qualified_name : dataset.id),
    description: typeof description === 'string' ? description : null,
    rowCount: dataset.rowCount ?? numberFrom(field(payload, 'row_count')),
    columnCount: dataset.columnCount ?? (columns.length || null),
    sizeBytes: null,
    qualityScore: null,
    lastRefreshedAt: null,
    owner: null,
    columns,
    sample: null,
    statsSampleSize: null,
    qualityIssues: [],
  };
}

async function tableView(connectionId: string, query: RequestQuery = {}): Promise<TableView> {
  const rows = await guarded(() => loadObjects(connectionId, undefined, { versionId: query.version }));

  const tables = rows.filter((r) => r.object_type === 'table');
  const names: string[] = tables.map((t) => t.qualified_name).sort((a, b) => b.length - a.length);
  const ownerOf = (name: string): string | null => names.find((t) => name === t || name.startsWith(`${t}.`)) ?? null;

  const groups = new Map<string, TableGroup>(
    tables.map((t) => [t.qualified_name, { table: t, columns: [], related: [] }])
  );
  const unattached: ObjectRow[] = [];
  for (const row of rows) {
    if (row.object_type === 'table') continue;
    if (row.object_type === 'column_stats') {
      const owner = ownerOf(row.qualified_name);
      const group = owner ? groups.get(owner) : undefined;
      if (group) group.columns.push(row);
      else unattached.push(row);
      continue;
    }
    const text = `${row.qualified_name}\n${JSON.stringify(row.payload || {})}`;
    const concerns = names.filter((t) => text.includes(t));
    if (concerns.length === 0) unattached.push(row);
    for (const t of concerns) groups.get(t)?.related.push(row);
  }

  const counts: Record<string, number> = {};
  let needsReview = 0;
  for (const row of rows) {
    counts[row.object_type] = (counts[row.object_type] || 0) + 1;
    if (reviewStatusOf(row) === REVIEW_STATUS.PENDING) needsReview += 1;
  }

  const needle = String(query.search || '')
    .trim()
    .slice(0, 100)
    .toLowerCase();
  const haystack = (row: ObjectRow): string =>
    `${row.qualified_name} ${JSON.stringify(row.payload || {})}`.toLowerCase();
  const matches = (row: ObjectRow): boolean => haystack(row).includes(needle);
  let list = [...groups.values()].sort((a, b) => a.table.qualified_name.localeCompare(b.table.qualified_name));
  if (needle) {
    list = list.filter((g) => [g.table, ...g.columns, ...g.related].some(matches));
  }

  const review = query.review === undefined || query.review === '' ? null : String(query.review);
  if (review !== null && review !== REVIEW_STATUS.PENDING) {
    throw fail('VALIDATION_ERROR', `review must be "${REVIEW_STATUS.PENDING}".`);
  }
  const pending = (row: ObjectRow): boolean => reviewStatusOf(row) === REVIEW_STATUS.PENDING;
  const reviewCounts = { tables: 0, columns: 0 };
  for (const g of groups.values()) {
    if (pending(g.table)) reviewCounts.tables += 1;
    reviewCounts.columns += g.columns.filter(pending).length;
  }
  let loose = needle ? unattached.filter(matches) : unattached;
  if (review) {
    list = list
      .map((g) => ({ table: g.table, columns: g.columns.filter(pending), related: g.related.filter(pending) }))
      .filter((g) => pending(g.table) || g.columns.length > 0);
    loose = loose.filter(pending);
  }

  const paging = pageOf(query, 10);
  return {
    resolvedVersionId: rows.length ? rows[0].version_id : null,
    count: rows.length,
    counts,
    needsReview,
    reviewCounts,
    tableCount: tables.length,
    matched: list.length,
    tables: list.slice(paging.offset, paging.offset + paging.pageSize).map((g) => ({
      table: shapeFact(g.table),
      columns: g.columns.map(shapeFact),
      related: g.related.map(shapeFact),
      needsReview: [g.table, ...g.columns, ...g.related].filter(pending).length,
    })),
    unattached: loose.map(shapeFact),
  };
}

async function reviewQueue(connectionId: string, query: RequestQuery = {}): Promise<ReviewQueue> {
  const result = await guarded(() =>
    contextRepository.pageObjects(
      connectionId,
      { ...query, versionId: query.version, highConfidenceAt: HIGH_CONFIDENCE },
      pageOf(query, 25)
    )
  );
  return {
    items: result.rows.map(shapeReviewItem),
    counts: result.counts,
    total: result.all,
    matched: result.matched,
    highConfidence: { threshold: HIGH_CONFIDENCE, pending: result.highConfidence ?? 0 },
  };
}

function requireDecision(decision: unknown): { status: string; verified: boolean | null } {
  if (typeof decision !== 'string' || !REVIEW_DECISIONS.has(decision)) {
    throw fail('VALIDATION_ERROR', `Unknown decision "${decision}".`);
  }
  return {
    status: REVIEW_DECISION_STATUS[decision],
    verified: decision === 'skip' ? null : decision === 'approve',
  };
}

async function reloadItem(connectionId: string, objectId: string): Promise<ReviewItem | null> {
  const updated: StoredObjectRow | null = await contextRepository.loadObject(connectionId, objectId);
  return updated ? shapeReviewItem(updated) : null;
}

async function decideReviewItem(
  actor: Actor,
  connectionId: string,
  objectId: string,
  decision: unknown
): Promise<ReviewItem | null> {
  const { status, verified } = requireDecision(decision);
  await contextRepository.requireObject(connectionId, objectId);
  await contextRepository.writeDecision(actor, connectionId, objectId, status, verified);
  return reloadItem(connectionId, objectId);
}

async function updateReviewItem(
  actor: Actor,
  connectionId: string,
  objectId: string,
  body: unknown = {}
): Promise<ReviewItem | null> {
  const existing = await contextRepository.requireObject(connectionId, objectId);

  const name = entry(body, 'name');
  if (name !== undefined && String(name) !== existing.qualified_name) {
    throw fail('VALIDATION_ERROR', 'Table and column names cannot be edited.');
  }

  const incoming: Record<string, unknown> = {};
  const description = entry(body, 'description');
  const formula = entry(body, 'formula');
  const fields = entry(body, 'fields');
  if (description !== undefined) incoming.description = description;
  if (formula !== undefined) incoming.formula = formula;
  if (fields && typeof fields === 'object') Object.assign(incoming, fields);

  const current = existing.payload || {};
  const patch: Record<string, unknown> = {};
  const refused: string[] = [];
  for (const [key, value] of Object.entries(incoming)) {
    const unchanged = JSON.stringify(value) === JSON.stringify(field(current, key));
    if (AI_TEXT_KEYS.has(key)) {
      if (value !== null && typeof value !== 'string') {
        throw fail('VALIDATION_ERROR', `"${key}" must be text.`);
      }
      if (!unchanged) patch[key] = value;
    } else if (!unchanged) {
      refused.push(key);
    }
  }
  if (refused.length > 0) {
    throw fail(
      'VALIDATION_ERROR',
      `Only the AI-generated text can be edited; names, source values and structure cannot (${refused.join(', ')}).`
    );
  }

  if (Object.keys(patch).length === 0) {
    throw fail('VALIDATION_ERROR', 'Nothing to update.');
  }

  await contextRepository.mergePayload(connectionId, objectId, patch);
  await contextRepository.markEdited(
    actor,
    connectionId,
    objectId,
    existing.verified ? REVIEW_STATUS.APPROVED : REVIEW_STATUS.PENDING
  );

  return reloadItem(connectionId, objectId);
}

async function bulkDecide(
  actor: Actor,
  connectionId: string,
  { decision, filter = {} }: { decision?: unknown; filter?: unknown } = {}
): Promise<{ affected: number }> {
  const { status, verified } = requireDecision(decision);

  const ids = await guarded(() => contextRepository.matchingObjectIds(connectionId, filter));
  if (!ids.length) return { affected: 0 };

  await contextRepository.writeBulkDecision(actor, connectionId, ids, status, verified);
  return { affected: ids.length };
}

function readable(value: unknown): string {
  const text = String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function termState(row: ObjectRow): string {
  const status = reviewStatusOf(row);
  if (status === REVIEW_STATUS.REJECTED) return 'rejected';
  if (row.review_edited) return 'human_override';
  if (status === REVIEW_STATUS.APPROVED) {
    return row.review_status === REVIEW_STATUS.APPROVED ? 'human_approved' : 'source_verified';
  }
  const confidence = row.confidence === null ? null : Number(row.confidence);
  return confidence !== null && confidence >= CONFIDENT ? 'ai_generated' : 'ai_suggested';
}

function appliesTo(row: ObjectRow): string | null {
  const payload = row.payload || {};
  const target = field(payload, 'applies_to');
  if (typeof target === 'string') return target;
  if (Array.isArray(target)) return target.join(', ');
  if (row.object_type === 'table') return row.qualified_name;
  const underlying = field(payload, 'underlying_table');
  if (typeof underlying === 'string') return underlying;
  return null;
}

function glossaryTerm(row: ObjectRow): Term {
  const payload = row.payload || {};
  const type =
    row.object_type === 'glossary' && field(payload, 'kind') === 'dimension'
      ? 'dimension'
      : TERM_TYPES[row.object_type];
  const term = field(payload, 'term');
  const description = field(payload, 'description');
  const definition = field(payload, 'definition');
  return {
    id: row.id,
    term: typeof term === 'string' && term ? term : readable(row.qualified_name),
    type,
    typeLabel: TYPE_LABELS[type],
    definition:
      (typeof description === 'string' && description) || (typeof definition === 'string' && definition) || null,
    appliesTo: appliesTo(row),
    confidence: row.confidence === null ? null : Number(row.confidence),
    state: termState(row),
    objectType: row.object_type,
    qualifiedName: row.qualified_name,
    reviewedAt: row.review_reviewed_at || row.reviewed_at || null,
  };
}

function glossaryStats(terms: Term[]): GlossaryStats {
  const scored: number[] = [];
  for (const t of terms) {
    if (t.confidence !== null) scored.push(t.confidence);
  }
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const human = terms.filter((t) => t.state === 'human_approved' || t.state === 'human_override');
  return {
    termsGenerated: terms.length,
    entityCount: terms.filter((t) => t.type === 'entity').length,
    metricCount: terms.filter((t) => t.type === 'metric').length,
    dimensionCount: terms.filter((t) => t.type === 'dimension' || t.type === 'term').length,
    averageConfidence: scored.length ? scored.reduce((sum, confidence) => sum + confidence, 0) / scored.length : null,
    humanApproved: human.length,
    approvedThisWeek: human.filter((t) => t.reviewedAt && new Date(t.reviewedAt).getTime() >= weekAgo).length,
  };
}

async function understanding(connectionId: string, query: RequestQuery = {}): Promise<Understanding> {
  const rows = await guarded(() =>
    loadObjects(connectionId, undefined, {
      types: Object.keys(TERM_TYPES),
      versionId: query.version,
    })
  );

  const terms = rows.filter((row) => TERM_TYPES[row.object_type]).map(glossaryTerm);
  terms.sort((a, b) => TERM_ORDER[a.type] - TERM_ORDER[b.type] || a.term.localeCompare(b.term));

  const filter = query.filter ? String(query.filter) : 'all';
  if (!Object.hasOwn(GLOSSARY_FILTERS, filter)) {
    throw fail('VALIDATION_ERROR', `filter must be one of: ${Object.keys(GLOSSARY_FILTERS).join(', ')}.`);
  }
  const states = GLOSSARY_FILTERS[filter];
  const needle = String(query.search || '')
    .trim()
    .toLowerCase();
  const selected = terms.filter((t) => {
    if (states && !states.includes(t.state)) return false;
    if (!needle) return true;
    return (
      t.term.toLowerCase().includes(needle) ||
      (t.definition || '').toLowerCase().includes(needle) ||
      (t.appliesTo || '').toLowerCase().includes(needle)
    );
  });
  const paging = pageOf(query, 10);

  return {
    matched: selected.length,
    stats: glossaryStats(terms),
    terms: selected.slice(paging.offset, paging.offset + paging.pageSize).map((t) => ({
      id: t.id,
      term: t.term,
      typeLabel: t.typeLabel,
      definition: t.definition,
      appliesTo: t.appliesTo,
      confidence: t.confidence,
      state: t.state,
    })),
  };
}

export {
  loadObjects,
  columnSplitter,
  listContextObjects,
  snapshotTableProfile,
  tableView,
  reviewQueue,
  decideReviewItem,
  requireDecision,
  updateReviewItem,
  bulkDecide,
  understanding,
};
export type {
  SnapshotColumn,
  SnapshotTableProfile,
  ContextObjectList,
  TableView,
  ReviewQueue,
  Term,
  GlossaryStats,
  Understanding,
};
