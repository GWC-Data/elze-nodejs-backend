import config from '../config';
import * as versionRepository from '../repositories/versionRepository';
import { fail } from '../tools/AppError';
import { shapeVersion, shapeExtraction, headline, deletedVersion } from '../views/serializers/versionSerializer';
import { CONTEXT_STEPS, VERSION_STATUS } from '../constants/statuses';
import { UNIQUE_VIOLATION } from '../constants/pgErrors';
import { sqlState } from '../tools/dbError';
import type { Tx } from '../config/database';
import type { Actor } from '../types/actor';

const { withTransaction } = config.database;

type Row = Record<string, any>;
type Connection = Record<string, any>;
type Version = Record<string, any>;

const VERSION_NOT_FOUND = 'Published version not found';

function stepRank(step: string): number {
  return CONTEXT_STEPS.indexOf(step);
}

function furthest(a: string, b: string): string {
  return stepRank(b) > stepRank(a) ? b : a;
}

async function versionState(connection: Connection): Promise<Record<string, any>> {
  const rows = await versionRepository.listForConnection(connection.id);
  const draft = rows.find((row: Row) => row.status === VERSION_STATUS.DRAFT) || null;
  const published = rows
    .filter((row: Row) => row.status === VERSION_STATUS.PUBLISHED)
    .sort((a: Row, b: Row) => (new Date(b.published_at) as any) - (new Date(a.published_at) as any));

  return {
    connectionId: connection.id,
    status: draft ? VERSION_STATUS.DRAFT : published.length ? VERSION_STATUS.PUBLISHED : 'none',
    draft: shapeVersion(draft),
    latestPublished: shapeVersion(published[0] || null),
    versions: rows.map(shapeVersion),
  };
}

async function openDraft(conn: Tx, actor: Actor | null | undefined, connection: Connection, step: string | null | undefined): Promise<Row> {
  const basedOn = await versionRepository.latestPublishedName(conn, connection.id);
  const name = basedOn ? basedOn.name : String(connection.name).slice(0, 120);
  const version = await versionRepository.nextVersion(conn, connection.id, name);

  return versionRepository.insertDraft(conn, {
    connectionId: connection.id,
    companyId: connection.companyId,
    name,
    version,
    step: (step || null) as string,
    datasetIds: (connection.selectedDatasets || []).map((d: any) => d.id),
    basedOnId: basedOn ? basedOn.id : null,
    createdBy: actor ? actor.id : null,
  });
}

function draftPatch(draft: Row, patch: Record<string, any>): versionRepository.DraftChanges {
  const changes: versionRepository.DraftChanges = {};
  const step = patch.step ? furthest(draft.current_step, patch.step) : null;
  if (step && step !== draft.current_step) changes.step = step;
  if (Array.isArray(patch.datasetIds)) changes.datasetIds = patch.datasetIds;
  if (patch.sessionId !== undefined) changes.sessionId = patch.sessionId;
  if (patch.extractionReport !== undefined) {
    changes.extraction = {
      report: patch.extractionReport,
      mode: patch.extractionMode || null,
      datasetIds: Array.isArray(patch.extractionDatasetIds) ? patch.extractionDatasetIds : [],
    };
  }
  return changes;
}

async function touchDraft(actor: Actor | null | undefined, connection: Connection, patch: Record<string, any> = {}, attempt = 0): Promise<Version | null> {
  try {
    const row = await withTransaction(async (conn: Tx) => {
      let draft = await versionRepository.lockDraft(conn, connection.id);
      if (!draft) draft = await openDraft(conn, actor, connection, patch.step);
      return versionRepository.updateDraft(conn, draft.id, draftPatch(draft, patch));
    });
    return shapeVersion(row);
  } catch (err: any) {
    if (sqlState(err) === UNIQUE_VIOLATION && attempt === 0) {
      return touchDraft(actor, connection, patch, attempt + 1);
    }
    throw err;
  }
}

async function trackStep(connection: Connection, step: string): Promise<Version | null> {
  if (!CONTEXT_STEPS.includes(step)) {
    throw fail('VALIDATION_ERROR', `Unknown step "${step}".`);
  }
  return shapeVersion(await versionRepository.advanceDraftStep(connection.id, CONTEXT_STEPS, step));
}

async function publishDraft(conn: Tx, actor: Actor, connection: Connection, { name, snapshot, datasets = [], stats, sessionId, notifyTeam }: { name: string; snapshot: any; datasets?: any[]; stats: any; sessionId: any; notifyTeam: any }): Promise<Version> {
  let draft = await versionRepository.lockDraft(conn, connection.id);
  if (!draft) draft = await openDraft(conn, actor, connection, 'publish');

  const version = await versionRepository.nextVersion(conn, connection.id, name, draft.id);

  return shapeVersion(await versionRepository.markPublished(conn, draft.id, {
    name,
    version,
    sessionId,
    snapshot,
    stats,
    notifyTeam,
    datasets,
    publishedBy: actor.id,
  }))!;
}

async function latestPublished(connectionId: string): Promise<Version | null> {
  return shapeVersion(await versionRepository.latestPublished(connectionId));
}

async function requirePublishedVersion(connection: Connection, versionId: unknown): Promise<Version> {
  const row = await versionRepository.findPublished(connection.id, versionId);
  if (!row) throw fail('RESOURCE_NOT_FOUND', VERSION_NOT_FOUND);

  const shaped = shapeVersion(row)!;
  let datasets: any[] = Array.isArray(row.datasets) ? row.datasets : [];
  if (datasets.length === 0 && shaped.datasetIds.length) {
    const live = new Map<string, any>((connection.selectedDatasets || []).map((d: any) => [String(d.id), d]));
    datasets = shaped.datasetIds.map((id: any) => {
      const known = live.get(String(id));
      return {
        id: String(id),
        name: known ? known.name : null,
        rowCount: known ? known.rowCount : null,
        columnCount: known ? known.columnCount : null,
        selectedAt: known ? known.selectedAt : shaped.publishedAt,
      };
    });
  }
  return { ...shaped, datasets };
}

async function deletePublishedVersion(connection: Connection, versionId: unknown): Promise<any> {
  return withTransaction(async (conn: Tx) => {
    const row = await versionRepository.deletePublished(conn, connection.id, versionId);
    if (!row) throw fail('RESOURCE_NOT_FOUND', VERSION_NOT_FOUND);
    await versionRepository.deleteLegacyPublication(conn, connection.id, versionId);
    return deletedVersion(row);
  });
}

async function currentDraft(connectionId: string): Promise<Version | null> {
  return shapeVersion(await versionRepository.currentDraft(connectionId));
}

async function extractionFor(connectionId: string, version?: Version | null): Promise<any> {
  const row = version
    ? await versionRepository.versionExtraction(connectionId, version.id)
    : await versionRepository.latestExtraction(connectionId);
  return shapeExtraction(row);
}

async function statusByConnection(connectionIds: string[]): Promise<Map<any, Record<string, any>>> {
  if (!connectionIds.length) return new Map();
  const byConnection = new Map<any, Record<string, any>>();
  for (const row of await versionRepository.statusHeadlines(connectionIds)) {
    const entry = byConnection.get(row.connection_id) || { draft: null, published: null };
    entry[row.status === VERSION_STATUS.DRAFT ? 'draft' : 'published'] = headline(row);
    byConnection.set(row.connection_id, entry);
  }
  return byConnection;
}

export {
  versionState,
  touchDraft,
  trackStep,
  publishDraft,
  latestPublished,
  requirePublishedVersion,
  deletePublishedVersion,
  currentDraft,
  extractionFor,
  statusByConnection,
};
