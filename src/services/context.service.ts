import * as contextRepository from '../repositories/context.repository';
import { fail } from '../tools/AppError';
import { pageOf } from '../tools/pagination';
import {
  reviewStatusOf,
  shapeFact,
  shapeReviewItem,
  contextObjectItem,
} from '../views/serializers/context.serializer';
import {
  AI_TEXT_KEYS,
  GENERIC_COLUMNS,
  TERM_TYPES,
  TYPE_LABELS,
  GLOSSARY_FILTERS,
  CONFIDENT,
  TERM_ORDER,
} from '../constants/context';
import { REVIEW_STATUS, REVIEW_DECISIONS, REVIEW_DECISION_STATUS } from '../constants/statuses';
import type { Actor } from '../types/actor';

type Row = Record<string, any>;
type Payload = Record<string, any>;
type GraphNode = Record<string, any>;
type Edge = Record<string, any>;
type Term = Record<string, any>;

const { loadObjects, guarded } = contextRepository;

const identifierKey = (name: unknown): string => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const isSystemColumn = (name: unknown): boolean => /^_.*_$/.test(String(name).trim());

function keyColumns(primaryKey: unknown): Set<string> {
  return new Set(
    String(primaryKey || '').split(/[,()]+/).map((t) => t.trim()).filter(Boolean)
  );
}

function foreignKeyColumns(payload: Payload): Set<any> {
  return new Set(
    (Array.isArray(payload.foreign_keys) ? payload.foreign_keys : []).map((fk: any) => fk && fk.column)
  );
}

function columnSplitter(rows: Row[]): (qualifiedName: unknown) => { table: string | null; column: string } {
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

async function listContextObjects(connectionId: string, query: Record<string, any> = {}): Promise<Record<string, any>> {
  const result = await guarded(() =>
    contextRepository.pageObjects(
      connectionId,
      { ...query, versionId: query.version, status: undefined },
      pageOf(query, 25)
    )
  );
  return {
    resolvedSessionId: result.sessionId,
    count: result.all,
    counts: result.counts,
    matched: result.matched,
    objects: result.rows.map(contextObjectItem),
  };
}

function inferredEdges(nodes: GraphNode[], tableFacts: Map<string, Payload>, joinEdges: Edge[]): Edge[] {
  const covered = new Set(joinEdges.map((e) => [e.source, e.target].sort().join('\u0000')));
  const out: Edge[] = [];
  const seen = new Set<string>();
  const byKey = nodes.map((n) => ({
    node: n,
    cols: new Map<string, any>(n.columns.map((c: any) => [identifierKey(c.name), c])),
  }));
  const add = (from: string, fromCol: string, to: string, toCol: string, rule: string, relationshipType: string, confidence: number, basis: string): void => {
    if (from === to) return;
    const pair = [from, to].sort().join('\u0000');
    if (covered.has(pair)) return;
    const id = `inferred:${[`${from}.${fromCol}`, `${to}.${toCol}`].sort().join('|')}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      source: from,
      target: to,
      sourceColumn: fromCol,
      targetColumn: toCol,
      relationshipType,
      confidence,
      status: 'inferred',
      rule,
      joinCondition: `${from}.${fromCol} = ${to}.${toCol}`,
      suggestion: basis,
    });
  };

  for (const [table, payload] of tableFacts) {
    for (const fk of Array.isArray(payload.foreign_keys) ? payload.foreign_keys : []) {
      if (!fk || !fk.column || typeof fk.references !== 'string') continue;
      const dot = fk.references.lastIndexOf('.');
      if (dot <= 0) continue;
      const target = fk.references.slice(0, dot);
      const targetCol = fk.references.slice(dot + 1);
      if (!nodes.some((n) => n.id === target)) continue;
      add(table, fk.column, target, targetCol, 'declared', 'many-to-one', 1,
        `Declared foreign key: ${table}.${fk.column} references ${fk.references}.`);
    }
  }

  for (const a of byKey) {
    for (const pk of a.node.columns.filter((c: any) => c.isPrimaryKey)) {
      const key = identifierKey(pk.name);
      if (!key || isSystemColumn(pk.name)) continue;
      for (const b of byKey) {
        if (b === a) continue;
        const match = b.cols.get(key);
        if (!match) continue;
        add(b.node.id, match.name, a.node.id, pk.name, 'primary_key', 'many-to-one', 0.8,
          `${b.node.id}.${match.name} has the same name as the primary key of ${a.node.id}.`);
      }
    }
  }

  for (let i = 0; i < byKey.length; i += 1) {
    for (let j = i + 1; j < byKey.length; j += 1) {
      const a = byKey[i];
      const b = byKey[j];
      for (const [key, col] of a.cols) {
        if (!key || GENERIC_COLUMNS.has(key) || isSystemColumn(col.name)) continue;
        const match = b.cols.get(key);
        if (!match) continue;
        add(a.node.id, col.name, b.node.id, match.name, 'same_name', 'many-to-many', 0.5,
          `Both tables have a column named "${col.name}". Detected from the name only - check the values match before relying on it.`);
      }
    }
  }
  return out;
}

function joinEdge(row: Row, left: string, right: string, keys: any[], payload: Payload): Edge {
  return {
    id: row.id,
    source: left,
    target: right,
    sourceColumn: keys[0].left ?? '',
    targetColumn: keys[0].right ?? '',
    relationshipType: payload.cardinality || 'related',
    confidence: row.confidence === null ? null : Number(row.confidence),
    status: reviewStatusOf(row) === REVIEW_STATUS.REJECTED
      ? 'rejected'
      : row.verified
        ? 'accepted'
        : 'suggested',
    joinCondition: keys
      .map((k: any) => `${left}.${k.left} = ${right}.${k.right}`)
      .join(' AND '),
    suggestion: payload.basis || null,
  };
}

async function modelGraph(connectionId: string, { versionId }: { versionId?: string | null } = {}): Promise<Record<string, any>> {
  const rows = await guarded(() => loadObjects(connectionId, undefined, { versionId }));

  const sessionId = rows.length ? rows[0].session_id : null;

  const split = columnSplitter(rows);
  const columnsByTable = new Map<string, Map<string, any>>();
  const tableFacts = new Map<string, Payload>(
    rows.filter((r: Row) => r.object_type === 'table').map((r: Row) => [r.qualified_name, r.payload || {}])
  );
  const addColumn = (table: string, column: Record<string, any>): void => {
    if (!columnsByTable.has(table)) columnsByTable.set(table, new Map());
    const list = columnsByTable.get(table)!;
    const prev = list.get(column.name);
    list.set(column.name, prev ? { ...prev, ...column, dataType: prev.dataType || column.dataType,
      isPrimaryKey: prev.isPrimaryKey || column.isPrimaryKey, isForeignKey: prev.isForeignKey || column.isForeignKey } : column);
  };
  for (const [table, payload] of tableFacts) {
    const keys = keyColumns(payload.primary_key);
    const foreign = foreignKeyColumns(payload);
    for (const col of Array.isArray(payload.columns) ? payload.columns : []) {
      if (!col || !col.name) continue;
      addColumn(table, {
        name: col.name,
        dataType: col.type ?? null,
        isPrimaryKey: keys.has(col.name),
        isForeignKey: foreign.has(col.name),
      });
    }
  }
  for (const row of rows) {
    if (row.object_type !== 'column_stats') continue;
    const { table, column } = split(row.qualified_name);
    if (!table) continue;
    const payload = row.payload || {};
    addColumn(table, {
      name: column,
      dataType: payload.data_type ?? null,
      isPrimaryKey: /candidate primary key/i.test(String(payload.note || '')),
      isForeignKey: false,
    });
  }

  const nodes = new Map<string, GraphNode>();
  const addNode = (name: string, kind: string): void => {
    if (!name || nodes.has(name)) return;
    nodes.set(name, {
      id: name,
      label: name,
      datasetId: null,
      kind,
      columns: [...(columnsByTable.get(name) || new Map()).values()],
      position: null,
    });
  };

  for (const row of rows) {
    if (row.object_type === 'table') addNode(row.qualified_name, 'table');
  }

  const edges: Edge[] = [];
  for (const row of rows) {
    if (row.object_type !== 'join') continue;
    const payload = row.payload || {};
    const tables = Array.isArray(payload.tables) ? payload.tables : [];
    const keys = Array.isArray(payload.join_keys) ? payload.join_keys : [];
    if (tables.length < 2 || keys.length === 0) continue;

    const [left, right] = tables;
    addNode(left, 'table');
    addNode(right, 'table');
    edges.push(joinEdge(row, left, right, keys, payload));
  }

  edges.push(...inferredEdges([...nodes.values()], tableFacts, edges));

  return {
    connectionId,
    status: rows.length ? 'ready' : 'pending',
    generatedAt: rows.length ? rows[0].created_at : null,
    error: null,
    sessionId,
    nodes: [...nodes.values()],
    edges,
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

async function snapshotTableProfile(connectionId: string, versionId: string | null | undefined, dataset: Record<string, any>): Promise<Record<string, any>> {
  const rows = await loadObjects(connectionId, undefined, { versionId });
  const tables: Row[] = rows.filter((r: Row) => r.object_type === 'table');
  const wanted = [dataset.id, dataset.name].filter(Boolean).map(identifierKey);
  const table =
    tables.find((t) => {
      const p = t.payload || {};
      return (
        wanted.includes(identifierKey(t.qualified_name)) ||
        [p.dataset_id, p.datasetId].filter(Boolean).map(String).includes(String(dataset.id))
      );
    }) || (tables.length === 1 ? tables[0] : null);

  const payload: Payload = (table && table.payload) || {};
  const split = columnSplitter(rows);
  const stats = new Map<string, any>();
  if (table) {
    for (const row of rows) {
      if (row.object_type !== 'column_stats') continue;
      const { table: owner, column } = split(row.qualified_name);
      if (owner === table.qualified_name) stats.set(column, row.payload || {});
    }
  }
  const declared: any[] = Array.isArray(payload.columns) ? payload.columns : [];
  const names: string[] = [...new Set<string>([...declared.map((c) => c && c.name).filter(Boolean), ...stats.keys()])];
  const keyTokens = keyColumns(payload.primary_key);
  const foreign = foreignKeyColumns(payload);

  const columns = names.map((name) => {
    const stat = stats.get(name) || {};
    const decl = declared.find((c) => c && c.name === name) || {};
    return {
      name,
      dataType: stat.data_type || decl.type || 'unknown',
      nullable: null,
      nullPercent: numberFrom(stat.null_rate),
      uniqueCount: numberFrom(stat.distinct_count_est ?? stat.distinct_values),
      semanticType: null,
      isPrimaryKey: keyTokens.has(name),
      isForeignKey: foreign.has(name),
      min: stat.min ?? null,
      max: stat.max ?? null,
      distribution: null,
    };
  });

  return {
    id: dataset.id,
    datasetId: dataset.id,
    name: dataset.name || (table ? table.qualified_name : dataset.id),
    description: typeof payload.description === 'string' ? payload.description : null,
    rowCount: dataset.rowCount ?? numberFrom(payload.row_count),
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

async function tableView(connectionId: string, query: Record<string, any> = {}): Promise<Record<string, any>> {
  const rows = await guarded(() => loadObjects(connectionId, undefined, { versionId: query.version }));

  const tables: Row[] = rows.filter((r: Row) => r.object_type === 'table');
  const names: string[] = tables.map((t: Row) => t.qualified_name).sort((a: string, b: string) => b.length - a.length);
  const ownerOf = (name: string): string | null => names.find((t) => name === t || name.startsWith(`${t}.`)) ?? null;

  const groups = new Map<string, { table: Row; columns: Row[]; related: Row[] }>(tables.map((t: Row) => [t.qualified_name, { table: t, columns: [], related: [] }]));
  const unattached: Row[] = [];
  for (const row of rows) {
    if (row.object_type === 'table') continue;
    if (row.object_type === 'column_stats') {
      const owner = ownerOf(row.qualified_name);
      if (owner) groups.get(owner)!.columns.push(row);
      else unattached.push(row);
      continue;
    }
    const text = `${row.qualified_name}\n${JSON.stringify(row.payload || {})}`;
    const concerns = names.filter((t) => text.includes(t));
    if (concerns.length === 0) unattached.push(row);
    for (const t of concerns) groups.get(t)!.related.push(row);
  }

  const counts: Record<string, number> = {};
  let needsReview = 0;
  for (const row of rows) {
    counts[row.object_type] = (counts[row.object_type] || 0) + 1;
    if (reviewStatusOf(row) === REVIEW_STATUS.PENDING) needsReview += 1;
  }

  const needle = String(query.search || '').trim().slice(0, 100).toLowerCase();
  const haystack = (row: Row): string => `${row.qualified_name} ${JSON.stringify(row.payload || {})}`.toLowerCase();
  const matches = (row: Row): boolean => haystack(row).includes(needle);
  let list = [...groups.values()].sort((a, b) =>
    a.table.qualified_name.localeCompare(b.table.qualified_name)
  );
  if (needle) {
    list = list.filter((g) => [g.table, ...g.columns, ...g.related].some(matches));
  }

  const paging = pageOf(query, 10);
  return {
    resolvedSessionId: rows.length ? rows[0].session_id : null,
    count: rows.length,
    counts,
    needsReview,
    tableCount: tables.length,
    matched: list.length,
    tables: list.slice(paging.offset, paging.offset + paging.pageSize).map((g) => ({
      table: shapeFact(g.table),
      columns: g.columns.map(shapeFact),
      related: g.related.map(shapeFact),
    })),
    unattached: (needle ? unattached.filter(matches) : unattached).map(shapeFact),
  };
}

async function reviewQueue(connectionId: string, query: Record<string, any> = {}): Promise<Record<string, any>> {
  const result = await guarded(() =>
    contextRepository.pageObjects(connectionId, { ...query, versionId: query.version }, pageOf(query, 25))
  );
  return {
    items: result.rows.map(shapeReviewItem),
    counts: result.counts,
    total: result.all,
    matched: result.matched,
  };
}

function requireDecision(decision: any): { status: any; verified: boolean | null } {
  if (!REVIEW_DECISIONS.has(decision)) {
    throw fail('VALIDATION_ERROR', `Unknown decision "${decision}".`);
  }
  return {
    status: REVIEW_DECISION_STATUS[decision],
    verified: decision === 'skip' ? null : decision === 'approve',
  };
}

async function reloadItem(connectionId: string, objectId: string): Promise<any> {
  const updated = await contextRepository.loadObject(connectionId, objectId);
  return updated ? shapeReviewItem(updated) : null;
}

async function decideReviewItem(actor: Actor, connectionId: string, objectId: string, decision: unknown): Promise<any> {
  const { status, verified } = requireDecision(decision);
  await contextRepository.requireObject(connectionId, objectId);
  await contextRepository.writeDecision(actor, connectionId, objectId, status, verified);
  return reloadItem(connectionId, objectId);
}

async function updateReviewItem(actor: Actor, connectionId: string, objectId: string, body: Record<string, any> = {}): Promise<any> {
  const existing = await contextRepository.requireObject(connectionId, objectId);

  if (body.name !== undefined && String(body.name) !== existing.qualified_name) {
    throw fail('VALIDATION_ERROR', 'Table and column names cannot be edited.');
  }

  const incoming: Record<string, any> = {};
  if (body.description !== undefined) incoming.description = body.description;
  if (body.formula !== undefined) incoming.formula = body.formula;
  if (body.fields && typeof body.fields === 'object') Object.assign(incoming, body.fields);

  const current: Payload = existing.payload || {};
  const patch: Record<string, any> = {};
  const refused: string[] = [];
  for (const [key, value] of Object.entries(incoming)) {
    const unchanged = JSON.stringify(value) === JSON.stringify(current[key]);
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

async function bulkDecide(actor: Actor, connectionId: string, { decision, filter = {} }: { decision?: unknown; filter?: Record<string, any> } = {}): Promise<{ affected: number }> {
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

function termState(row: Row): string {
  const status = reviewStatusOf(row);
  if (status === REVIEW_STATUS.REJECTED) return 'rejected';
  if (row.review_edited) return 'human_override';
  if (status === REVIEW_STATUS.APPROVED) {
    return row.review_status === REVIEW_STATUS.APPROVED ? 'human_approved' : 'source_verified';
  }
  const confidence = row.confidence === null ? null : Number(row.confidence);
  return confidence !== null && confidence >= CONFIDENT ? 'ai_generated' : 'ai_suggested';
}

function appliesTo(row: Row): string | null {
  const payload = row.payload || {};
  if (typeof payload.applies_to === 'string') return payload.applies_to;
  if (Array.isArray(payload.applies_to)) return payload.applies_to.join(', ');
  if (row.object_type === 'table') return row.qualified_name;
  if (typeof payload.underlying_table === 'string') return payload.underlying_table;
  return null;
}

function glossaryTerm(row: Row): Term {
  const payload = row.payload || {};
  const type =
    row.object_type === 'glossary' && payload.kind === 'dimension'
      ? 'dimension'
      : TERM_TYPES[row.object_type];
  return {
    id: row.id,
    term: typeof payload.term === 'string' && payload.term ? payload.term : readable(row.qualified_name),
    type,
    typeLabel: TYPE_LABELS[type],
    definition:
      (typeof payload.description === 'string' && payload.description) ||
      (typeof payload.definition === 'string' && payload.definition) ||
      null,
    appliesTo: appliesTo(row),
    confidence: row.confidence === null ? null : Number(row.confidence),
    state: termState(row),
    objectType: row.object_type,
    qualifiedName: row.qualified_name,
    reviewedAt: row.review_reviewed_at || row.reviewed_at || null,
  };
}

function glossaryStats(terms: Term[]): Record<string, any> {
  const scored = terms.filter((t) => t.confidence !== null);
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const human = terms.filter((t) => t.state === 'human_approved' || t.state === 'human_override');
  return {
    termsGenerated: terms.length,
    entityCount: terms.filter((t) => t.type === 'entity').length,
    metricCount: terms.filter((t) => t.type === 'metric').length,
    dimensionCount: terms.filter((t) => t.type === 'dimension' || t.type === 'term').length,
    averageConfidence: scored.length
      ? scored.reduce((sum, t) => sum + t.confidence, 0) / scored.length
      : null,
    humanApproved: human.length,
    approvedThisWeek: human.filter((t) => t.reviewedAt && new Date(t.reviewedAt).getTime() >= weekAgo).length,
  };
}

async function understanding(connectionId: string, query: Record<string, any> = {}): Promise<Record<string, any>> {
  const rows = await guarded(() =>
    loadObjects(connectionId, undefined, {
      types: Object.keys(TERM_TYPES),
      versionId: query.version,
    })
  );

  const terms: Term[] = rows.filter((row: Row) => TERM_TYPES[row.object_type]).map(glossaryTerm);
  terms.sort((a, b) => TERM_ORDER[a.type] - TERM_ORDER[b.type] || a.term.localeCompare(b.term));

  const filter = query.filter ? String(query.filter) : 'all';
  if (!Object.prototype.hasOwnProperty.call(GLOSSARY_FILTERS, filter)) {
    throw fail('VALIDATION_ERROR', `filter must be one of: ${Object.keys(GLOSSARY_FILTERS).join(', ')}.`);
  }
  const states = GLOSSARY_FILTERS[filter];
  const needle = String(query.search || '').trim().toLowerCase();
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
  modelGraph,
  snapshotTableProfile,
  tableView,
  reviewQueue,
  decideReviewItem,
  updateReviewItem,
  bulkDecide,
  understanding,
};
