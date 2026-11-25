import { fail } from '../../shared/errors/AppError';
import { isContextAdmin, levelOf } from '../contextLayer/contextAccessService';
import { groupByTable, isTableOfDataset, loadObjects } from '../contextLayer/contextService';
import { snapshotEntry } from '../contextLayer/contextSerializer';
import * as mcpDataRepository from './mcpDataRepository';
import * as mcpTokenRepository from './mcpTokenRepository';
import {
  CONTEXT_NOT_FOUND,
  contextKeyOf,
  entryFilterOf,
  nextCursor,
  pageWindow,
  qualifiedNameOf,
  searchTextOf,
  versionOf,
} from './mcpDataValidator';
import { datasetsOf, overviewsOf, shapeDataset, shapeOverview, shapeSummary, shapeVersion } from './mcpDataSerializer';
import type { ContextAccessLevel } from '../contextLayer/contextConstants';
import type { TableGroup } from '../contextLayer/contextService';
import type { SnapshotEntry } from '../contextLayer/contextSerializer';
import type { JsonValue } from '../contextLayer/contextTypes';
import type { Actor } from '../../shared/types/actor';
import type { ContextVersionRow, PublishedRow } from './mcpDataRepository';
import type { ContextDataset, ContextOverview, ContextSummary, ContextVersionEntry } from './mcpDataSerializer';

type Params = Record<string, unknown>;
type Query = Record<string, unknown>;

interface Page<T> {
  items: T[];
  total: number;
  nextCursor: string | null;
}

interface EntryPage extends Page<JsonValue> {
  version: number;
}

interface TableDescription {
  version: number;
  table: SnapshotEntry;
  columns: SnapshotEntry[];
  related: SnapshotEntry[];
  dataset: ContextDataset | null;
}

interface ReadableVersion {
  row: ContextVersionRow;
  access: ContextAccessLevel;
}

interface TokenSession {
  user: { id: string; username: string; displayName: string | null; companyId: string | null; isPlatform: boolean };
  token: { id: string; prefix: string; scope: string; expiresAt: Date };
}

const TABLE_NOT_FOUND = 'That table is not in this version of the context.';

function byNewest(a: PublishedRow, b: PublishedRow): number {
  const time = (row: PublishedRow) => new Date(row.published_at ?? 0).getTime();
  return time(b) - time(a) || a.name.localeCompare(b.name) || a.connection_id.localeCompare(b.connection_id);
}

async function readableVersion(actor: Actor, params: Params, query: Query): Promise<ReadableVersion> {
  const { connectionId, name } = contextKeyOf(params);
  const version = versionOf(query.version);
  const row = await mcpDataRepository.findVersion(actor, connectionId, name, version);
  const access = row ? levelOf(actor, row) : null;
  if (row && access) return { row, access };

  if (version !== null) {
    const live = await mcpDataRepository.findVersion(actor, connectionId, name, null);
    if (live && levelOf(actor, live)) {
      throw fail('RESOURCE_NOT_FOUND', `Version ${version} of this context is not published.`);
    }
  }
  throw fail('RESOURCE_NOT_FOUND', CONTEXT_NOT_FOUND);
}

async function tokenSession(actor: Actor, tokenId: string | undefined): Promise<TokenSession> {
  const token = tokenId ? await mcpTokenRepository.findById(tokenId) : null;
  if (!token) throw fail('UNAUTHENTICATED', 'This MCP token is not valid.');
  return {
    user: {
      id: actor.id,
      username: actor.username,
      displayName: actor.displayName,
      companyId: actor.companyId,
      isPlatform: actor.isPlatform,
    },
    token: { id: token.id, prefix: token.tokenPrefix, scope: token.scope, expiresAt: token.expiresAt },
  };
}

async function listContexts(actor: Actor, query: Query): Promise<Page<ContextSummary>> {
  const window = pageWindow(query);
  const rows = await mcpDataRepository.listPublished(actor, isContextAdmin(actor), searchTextOf(query.q));

  const groups = new Map<string, { live: PublishedRow; count: number }>();
  for (const row of rows) {
    const key = `${row.connection_id}\u0000${row.name}`;
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { live: row, count: 1 });
  }

  const readable: ContextSummary[] = [];
  for (const { live, count } of [...groups.values()].sort((a, b) => byNewest(a.live, b.live))) {
    const access = levelOf(actor, live);
    if (access) readable.push(shapeSummary(live, access, count));
  }

  return {
    items: readable.slice(window.offset, window.offset + window.limit),
    total: readable.length,
    nextCursor: nextCursor(window, readable.length),
  };
}

async function contextOverview(actor: Actor, params: Params, query: Query): Promise<ContextOverview> {
  const { row, access } = await readableVersion(actor, params, query);
  return shapeOverview(row, access);
}

async function contextVersions(actor: Actor, params: Params): Promise<{ items: ContextVersionEntry[] }> {
  const { row } = await readableVersion(actor, params, {});
  const versions = await mcpDataRepository.listVersions(row.connection_id, row.name);
  return { items: versions.map((v) => shapeVersion(v, Number(row.live_version))) };
}

async function contextObjects(actor: Actor, params: Params, query: Query): Promise<EntryPage> {
  const window = pageWindow(query);
  const filter = entryFilterOf(query);
  const { row } = await readableVersion(actor, params, query);
  const [total, items] = await Promise.all([
    mcpDataRepository.countEntries(row.id, filter),
    mcpDataRepository.pageEntries(row.id, filter, window),
  ]);
  return { version: Number(row.version), items, total, nextCursor: nextCursor(window, total) };
}

function findGroup(groups: Map<string, TableGroup>, qualifiedName: string): TableGroup | null {
  const exact = groups.get(qualifiedName);
  if (exact) return exact;
  const wanted = qualifiedName.toLowerCase();
  const matches = [...groups.values()].filter((g) => g.table.qualified_name.toLowerCase() === wanted);
  return matches.length === 1 ? matches[0] : null;
}

async function describeTable(actor: Actor, params: Params, query: Query): Promise<TableDescription> {
  const qualifiedName = qualifiedNameOf(query.qualifiedName, true) ?? '';
  const { row } = await readableVersion(actor, params, query);
  const facts = await loadObjects(row.connection_id, undefined, { versionId: row.id });
  const group = findGroup(groupByTable(facts).groups, qualifiedName);
  if (!group) throw fail('RESOURCE_NOT_FOUND', TABLE_NOT_FOUND);

  const dataset = datasetsOf(row).find((d) => isTableOfDataset(group.table, d));
  return {
    version: Number(row.version),
    table: snapshotEntry(group.table),
    columns: group.columns.map(snapshotEntry),
    related: group.related.map(snapshotEntry),
    dataset: dataset ? shapeDataset(dataset, overviewsOf(row)) : null,
  };
}

export { tokenSession, listContexts, contextOverview, contextVersions, contextObjects, describeTable };
export type { Page, EntryPage, TableDescription, TokenSession };
