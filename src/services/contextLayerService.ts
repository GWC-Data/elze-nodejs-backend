import { fail } from '../tools/AppError';
import { readLimit, extractionRecord } from '../validators/contextValidator';
import { listedDataset } from '../views/serializers/connectionSerializer';
import { CONNECTORS, findConnector, STATUS } from '../constants/connectorCatalogue';
import { resolveTargetCompany } from './authorizationService';
import { requireActiveCompany } from './companyService';
import * as connections from './connectionService';
import * as contextService from './contextService';
import * as contextProfiles from './contextProfileService';
import * as publish from './publishService';
import * as versions from './versionService';
import { mcpDetails } from './mcpService';
import { audit, EVENTS } from './auditService';
import type { Actor } from '../types/actor';

type Connection = Record<string, any>;
type Query = Record<string, any>;

async function recordDraft(actor: Actor, connection: Connection, patch: Record<string, any>): Promise<void> {
  try {
    await versions.touchDraft(actor, connection, patch);
  } catch (err: any) {
    console.warn(`[context] could not update the draft for ${connection.id}: ${err.message}`);
  }
}

function onConnection(connection: Connection): Record<string, unknown> {
  return {
    connectionId: connection.id,
    connectionName: connection.name ?? null,
    companyId: connection.companyId ?? null,
  };
}

async function versionFor(connection: Connection, versionId: unknown): Promise<any> {
  if (versionId === undefined || versionId === '') return null;
  return versions.requirePublishedVersion(connection, String(versionId));
}

function listConnectors(): typeof CONNECTORS {
  return CONNECTORS;
}

async function listConnections(actor: Actor): Promise<Record<string, any>[]> {
  const list = await connections.listConnections(actor);
  const status = await versions.statusByConnection(list.map((c: any) => c.id));
  return list.map((c: any) => {
    const s = status.get(c.id) || { draft: null, published: null };
    return { ...c, context: s.draft || s.published, published: s.published };
  });
}

async function mcpAccess(actor: Actor, id: unknown): Promise<Record<string, any>> {
  const connection = await connections.requireConnection(actor, id);
  const published = await versions.latestPublished(connection.id);
  if (!published) {
    throw fail('RESOURCE_NOT_FOUND', 'This connection has no published context yet.');
  }
  return mcpDetails(connection, {
    name: published.name,
    label: `v${published.version}`,
    publishedAt: published.published_at || published.publishedAt || null,
  });
}

async function createConnection(actor: Actor, body: Record<string, any> = {}): Promise<any> {
  const { provider, name, host, token } = body;

  const connector = findConnector(provider);
  if (!connector) {
    throw fail('VALIDATION_ERROR', `"${provider}" is not a connector this platform knows about.`);
  }
  if (connector.status !== STATUS.available) {
    throw fail(
      'VALIDATION_ERROR',
      `The ${connector.name} connector is not built yet, so it cannot be configured.`
    );
  }

  const companyId = resolveTargetCompany(actor, body.companyId);
  await requireActiveCompany(actor, companyId, 'That company is deactivated, so connections cannot be added to it.');

  const result = await connections.createConnection(actor, companyId, {
    provider: connector.id,
    name,
    host,
    token,
    limit: readLimit(body.limit),
  });

  audit(EVENTS.CONTEXT_CONNECTION_CREATED, actor, {
    connectionId: result.connection.id,
    provider: result.connection.provider,
    connectionName: result.connection.name,
    host: result.connection.host,
    companyId,
    datasetsListed: result.datasets.length,
    datasetLimit: result.limit,
    datasetsTruncated: result.truncated,
  });

  await recordDraft(actor, result.connection, { step: 'discover' });
  return result;
}

async function getConnection(actor: Actor, id: unknown, versionId: unknown): Promise<any> {
  const connection = await connections.requireConnection(actor, id);
  const version = await versionFor(connection, versionId);
  return version ? { ...connection, selectedDatasets: version.datasets } : connection;
}

async function listDatasets(actor: Actor, id: unknown, query: Query = {}): Promise<Record<string, any>> {
  const limit = readLimit(query.limit);
  if (query.version) {
    const connection = await connections.requireConnection(actor, id);
    const version = await versionFor(connection, query.version);
    const listed = version.datasets.map(listedDataset);
    return { datasets: listed, fetchedAt: version.publishedAt, limit: listed.length, truncated: false };
  }
  const listing = await connections.fetchDatasets(actor, id, { limit });
  return {
    datasets: listing.datasets,
    fetchedAt: new Date().toISOString(),
    limit: listing.limit,
    truncated: listing.truncated,
  };
}

async function profile(actor: Actor, id: unknown, versionId: unknown): Promise<any> {
  if (versionId) {
    const connection = await connections.requireConnection(actor, id);
    const version = await versionFor(connection, versionId);
    return connections.profileOverview(actor, id, { datasets: version.datasets });
  }
  return connections.profileOverview(actor, id);
}

async function tableProfile(actor: Actor, id: unknown, tableId: unknown, versionId: unknown): Promise<any> {
  if (versionId) {
    const connection = await connections.requireConnection(actor, id);
    const version = await versionFor(connection, versionId);
    const dataset = version.datasets.find((d: any) => String(d.id) === String(tableId));
    if (!dataset) {
      throw fail('RESOURCE_NOT_FOUND', 'That table is not part of this published version.');
    }
    return contextService.snapshotTableProfile(connection.id, version.id, dataset);
  }
  return connections.tableProfile(actor, id, tableId);
}

async function versionState(actor: Actor, id: unknown): Promise<Record<string, any>> {
  const connection = await connections.requireConnection(actor, id);
  return versions.versionState(connection);
}

async function createVersion(actor: Actor, id: unknown): Promise<Record<string, any>> {
  const connection = await connections.requireConnection(actor, id, 'edit');
  await versions.touchDraft(actor, connection, { step: 'discover' });
  const state = await versions.versionState(connection);
  audit(EVENTS.CONTEXT_VERSION_CREATED, actor, {
    ...onConnection(connection),
    versionId: state.draft?.id ?? null,
    name: state.draft?.name ?? null,
    version: state.draft?.version ?? null,
  });
  return state;
}

async function deleteVersion(actor: Actor, id: unknown, versionId: unknown): Promise<{ deleted: any }> {
  const connection = await connections.requireConnection(actor, id, 'full');
  const deleted = await versions.deletePublishedVersion(connection, versionId);
  audit(EVENTS.CONTEXT_VERSION_DELETED, actor, {
    ...onConnection(connection),
    versionId: deleted.id,
    name: deleted.name,
    version: deleted.label,
    objectCount: deleted.objectCount,
  });
  return { deleted };
}

async function trackDraft(actor: Actor, id: unknown, step: string): Promise<{ draft: any }> {
  const connection = await connections.requireConnection(actor, id, 'edit');
  return { draft: await versions.trackStep(connection, step) };
}

async function contextProfile(actor: Actor, id: unknown): Promise<any> {
  const connection = await connections.requireConnection(actor, id);
  return contextProfiles.contextProfile(connection.id);
}

async function saveContextProfile(actor: Actor, id: unknown, body: Record<string, any>): Promise<any> {
  const connection = await connections.requireConnection(actor, id, 'edit');
  const profile = await contextProfiles.saveContextProfile(connection, actor, body);
  audit(EVENTS.CONTEXT_PROFILE_SAVED, actor, {
    ...onConnection(connection),
    name: profile.name,
  });
  return profile;
}

async function extraction(actor: Actor, id: unknown, versionId: unknown): Promise<any> {
  const connection = await connections.requireConnection(actor, id);
  const version = await versionFor(connection, versionId);
  return versions.extractionFor(connection.id, version);
}

async function recordExtraction(actor: Actor, id: unknown, body: Record<string, any>): Promise<{ draft: any }> {
  const connection = await connections.requireConnection(actor, id, 'edit');
  const record = extractionRecord(body);
  const draft = await versions.touchDraft(actor, connection, {
    step: 'understand',
    ...record,
    extractionMode: 'agent',
  });
  return { draft };
}

async function readFacts<T>(actor: Actor, id: unknown, query: Query, read: (connection: Connection, version: any) => Promise<T>): Promise<T> {
  const connection = await connections.requireConnectionId(actor, id);
  const version = await versionFor(connection, query.version);
  return read(connection, version);
}

function understanding(actor: Actor, id: unknown, query: Query = {}): Promise<Record<string, any>> {
  return readFacts(actor, id, query, (connection) => contextService.understanding(connection.id, query));
}

function contextObjects(actor: Actor, id: unknown, query: Query = {}): Promise<Record<string, any>> {
  return readFacts(actor, id, query, (connection) => contextService.listContextObjects(connection.id, query));
}

function factsByTable(actor: Actor, id: unknown, query: Query = {}): Promise<Record<string, any>> {
  return readFacts(actor, id, query, (connection) => contextService.tableView(connection.id, query));
}

function model(actor: Actor, id: unknown, query: Query = {}): Promise<Record<string, any>> {
  return readFacts(actor, id, query, (connection, version) =>
    contextService.modelGraph(connection.id, { versionId: version ? version.id : undefined })
  );
}

function review(actor: Actor, id: unknown, query: Query = {}): Promise<Record<string, any>> {
  return readFacts(actor, id, query, (connection) => contextService.reviewQueue(connection.id, query));
}

async function decide(actor: Actor, id: unknown, itemId: string, { decision, update }: { decision?: unknown; update?: Record<string, any> } = {}): Promise<any> {
  const connection = await connections.requireConnection(actor, id, 'edit');

  if (update) {
    await contextService.updateReviewItem(actor, connection.id, itemId, update);
  }
  const item = await contextService.decideReviewItem(actor, connection.id, itemId, decision);

  audit(EVENTS.CONTEXT_REVIEW_DECIDED, actor, {
    ...onConnection(connection),
    objectId: itemId,
    decision,
    edited: Boolean(update),
  });
  await recordDraft(actor, connection, { step: 'review' });
  return item;
}

async function editItem(actor: Actor, id: unknown, itemId: string, body: Record<string, any>): Promise<any> {
  const connection = await connections.requireConnection(actor, id, 'edit');
  const item = await contextService.updateReviewItem(actor, connection.id, itemId, body);
  audit(EVENTS.CONTEXT_FACT_UPDATED, actor, {
    ...onConnection(connection),
    objectId: itemId,
    fields: Object.keys(body || {}).join(', '),
  });
  await recordDraft(actor, connection, { step: 'review' });
  return item;
}

async function bulkDecide(actor: Actor, id: unknown, body: Record<string, any> = {}): Promise<{ affected: number }> {
  const connection = await connections.requireConnection(actor, id, 'edit');
  const result = await contextService.bulkDecide(actor, connection.id, body);

  audit(EVENTS.CONTEXT_REVIEW_DECIDED, actor, {
    ...onConnection(connection),
    decision: body.decision,
    bulk: true,
    affected: result.affected,
  });
  if (result.affected > 0) await recordDraft(actor, connection, { step: 'review' });
  return result;
}

async function publishSummary(actor: Actor, id: unknown, versionId: unknown): Promise<Record<string, any>> {
  const connection = await connections.requireConnection(actor, id);
  const version = await versionFor(connection, versionId);
  return publish.publishSummary(actor, connection, { version });
}

async function validatePublish(actor: Actor, id: unknown): Promise<Record<string, any>> {
  const connection = await connections.requireConnection(actor, id);
  return publish.validatePublish(actor, connection);
}

async function listPublications(actor: Actor, id: unknown): Promise<Record<string, any>[]> {
  const connection = await connections.requireConnection(actor, id);
  return publish.listPublications(connection.id);
}

async function publishContext(actor: Actor, id: unknown, body: Record<string, any>): Promise<Record<string, any>> {
  const connection = await connections.requireConnection(actor, id, 'edit');
  const result = await publish.publishContext(actor, connection, body);

  audit(EVENTS.CONTEXT_PUBLISHED, actor, {
    ...onConnection(connection),
    publicationId: result.id,
    name: result.name,
    version: result.version,
    objectCount: result.objectCount,
  });
  return result;
}

async function selectDatasets(actor: Actor, id: unknown, datasets: unknown): Promise<any> {
  const connection = await connections.replaceSelection(actor, id, datasets);
  const datasetIds = connection.selectedDatasets.map((d: any) => d.id);

  audit(EVENTS.CONTEXT_DATASETS_SELECTED, actor, {
    ...onConnection(connection),
    provider: connection.provider,
    datasetCount: datasetIds.length,
    datasetIds,
  });

  await recordDraft(actor, connection, { step: 'profile', datasetIds });
  return connection;
}

async function deleteConnection(actor: Actor, id: unknown): Promise<{ deleted: true }> {
  const removed = await connections.deleteConnection(actor, id);
  audit(EVENTS.CONTEXT_CONNECTION_DELETED, actor, {
    connectionId: id,
    connectionName: removed.name,
    companyId: removed.companyId,
    provider: removed.provider,
  });
  return { deleted: true };
}

const listCompanyPublished = publish.listCompanyPublished;
const listPublishedConnections = connections.listPublishedConnections;
const listPublishedVersionOptions = connections.listPublishedVersionOptions;
const verifyConnection = connections.verifyConnection;

export {
  listConnectors,
  listConnections,
  listCompanyPublished,
  listPublishedConnections,
  listPublishedVersionOptions,
  mcpAccess,
  createConnection,
  getConnection,
  verifyConnection,
  listDatasets,
  profile,
  tableProfile,
  versionState,
  createVersion,
  deleteVersion,
  trackDraft,
  contextProfile,
  saveContextProfile,
  extraction,
  recordExtraction,
  understanding,
  contextObjects,
  factsByTable,
  model,
  review,
  decide,
  editItem,
  bulkDecide,
  publishSummary,
  validatePublish,
  listPublications,
  publishContext,
  selectDatasets,
  deleteConnection,
};
