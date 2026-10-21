import config from '../../config';
import * as versionRepository from './versionRepository';
import type { DraftRow } from './versionRepository';
import { fail } from '../../shared/errors/AppError';
import { shapeVersion, shapeExtraction, headline, deletedVersion } from './versionSerializer';
import type { DeletedVersion, Extraction, Headline, PublishedVersion, Version } from './versionSerializer';
import { CONTEXT_STEPS, VERSION_STATUS } from '../../shared/db/statuses';
import { UNIQUE_VIOLATION } from '../../shared/errors/pgErrors';
import { sqlState } from '../../shared/db/dbError';
import type { Tx } from '../../shared/db/database';
import type { Actor } from '../../shared/types/actor';
import type { ContextStep } from '../../generated/prisma/enums';
import type { SelectedDataset } from './connectionSerializer';
import type { DraftTarget, FallbackDataset, PublishedDataset } from './contextTypes';

const { withTransaction } = config.database;

interface DraftPatch {
  step?: ContextStep;
  datasetIds?: string[];
  sessionId?: string | null;
  extractionReport?: string;
  extractionMode?: string;
  extractionDatasetIds?: string[];
}

interface VersionState {
  connectionId: string;
  status: string;
  draft: Version | null;
  latestPublished: Version | null;
  versions: Version[];
}

interface ConnectionHeadlines {
  draft: Headline | null;
  published: Headline | null;
}

const VERSION_NOT_FOUND = 'Published version not found';

function isContextStep(step: unknown): step is ContextStep {
  return typeof step === 'string' && CONTEXT_STEPS.some((known) => known === step);
}

function stepRank(step: ContextStep | null): number {
  return step === null ? -1 : CONTEXT_STEPS.indexOf(step);
}

function furthest(a: ContextStep | null, b: ContextStep): ContextStep | null {
  return stepRank(b) > stepRank(a) ? b : a;
}

function timeOf(value: Date | null): number {
  return new Date(value ?? 0).getTime();
}

async function versionState(connection: { id: string }): Promise<VersionState> {
  const rows = await versionRepository.listForConnection(connection.id);
  const draft = rows.find((row) => row.status === VERSION_STATUS.DRAFT) || null;
  const published = rows
    .filter((row) => row.status === VERSION_STATUS.PUBLISHED)
    .sort((a, b) => timeOf(b.published_at) - timeOf(a.published_at));

  return {
    connectionId: connection.id,
    status: draft ? VERSION_STATUS.DRAFT : published.length ? VERSION_STATUS.PUBLISHED : 'none',
    draft: shapeVersion(draft),
    latestPublished: shapeVersion(published[0] || null),
    versions: rows.map((row) => shapeVersion(row)),
  };
}

async function openDraft(
  conn: Tx,
  actor: Actor | null | undefined,
  connection: DraftTarget,
  step: ContextStep | null | undefined
): Promise<DraftRow> {
  const basedOn = await versionRepository.latestPublishedName(conn, connection.id);
  const name = basedOn ? basedOn.name : String(connection.name).slice(0, 120);
  const version = await versionRepository.nextVersion(conn, connection.id, name);

  return versionRepository.insertDraft(conn, {
    connectionId: connection.id,
    companyId: connection.companyId,
    name,
    version,
    step: step || null,
    datasetIds: (connection.selectedDatasets || []).map((d) => d.id),
    basedOnId: basedOn ? basedOn.id : null,
    createdBy: actor ? actor.id : null,
  });
}

function draftPatch(draft: DraftRow, patch: DraftPatch): versionRepository.DraftChanges {
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

async function touchDraft(
  actor: Actor | null | undefined,
  connection: DraftTarget,
  patch: DraftPatch = {},
  attempt = 0
): Promise<Version | null> {
  try {
    const row = await withTransaction(async (conn: Tx) => {
      let draft = await versionRepository.lockDraft(conn, connection.id);
      if (!draft) draft = await openDraft(conn, actor, connection, patch.step);
      return versionRepository.updateDraft(conn, draft.id, draftPatch(draft, patch));
    });
    return shapeVersion(row);
  } catch (err) {
    if (sqlState(err) === UNIQUE_VIOLATION && attempt === 0) {
      return touchDraft(actor, connection, patch, attempt + 1);
    }
    throw err;
  }
}

async function trackStep(connection: { id: string }, step: unknown): Promise<Version | null> {
  if (!isContextStep(step)) {
    throw fail('VALIDATION_ERROR', `Unknown step "${step}".`);
  }
  return shapeVersion(await versionRepository.advanceDraftStep(connection.id, CONTEXT_STEPS, step));
}

async function publishDraft(
  conn: Tx,
  actor: Actor,
  connection: DraftTarget,
  {
    name,
    snapshot,
    datasets = [],
    stats,
    sessionId,
    notifyTeam,
  }: {
    name: string;
    snapshot: readonly unknown[];
    datasets?: readonly { id: string }[];
    stats: unknown;
    sessionId: string | null;
    notifyTeam: unknown;
  }
): Promise<Version> {
  let draft = await versionRepository.lockDraft(conn, connection.id);
  if (!draft) draft = await openDraft(conn, actor, connection, 'publish');

  const version = await versionRepository.nextVersion(conn, connection.id, name, draft.id);

  const published = await versionRepository.markPublished(conn, draft.id, {
    name,
    version,
    sessionId,
    snapshot,
    stats,
    notifyTeam,
    datasets,
    publishedBy: actor.id,
  });
  if (!published) throw new Error(`The draft ${draft.id} disappeared while it was being published.`);
  return shapeVersion(published);
}

async function latestPublished(connectionId: string): Promise<Version | null> {
  return shapeVersion(await versionRepository.latestPublished(connectionId));
}

async function requirePublishedVersion(
  connection: { id: string; selectedDatasets?: readonly SelectedDataset[] },
  versionId: string
): Promise<PublishedVersion> {
  const row = await versionRepository.findPublished(connection.id, versionId);
  if (!row) throw fail('RESOURCE_NOT_FOUND', VERSION_NOT_FOUND);

  const shaped = shapeVersion(row);
  let datasets: PublishedDataset[] = Array.isArray(row.datasets) ? row.datasets : [];
  if (datasets.length === 0 && shaped.datasetIds.length) {
    const live = new Map<string, SelectedDataset>((connection.selectedDatasets || []).map((d) => [String(d.id), d]));
    datasets = shaped.datasetIds.map((id): FallbackDataset => {
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

async function deletePublishedVersion(
  connection: { id: string },
  versionId: string,
  deletedBy: number | null,
  { permanent = false }: { permanent?: boolean } = {}
): Promise<DeletedVersion> {
  return withTransaction(async (conn: Tx) => {
    const row = await versionRepository.deletePublished(conn, connection.id, versionId, deletedBy, { permanent });
    if (!row) throw fail('RESOURCE_NOT_FOUND', VERSION_NOT_FOUND);
    return deletedVersion(row);
  });
}

async function currentDraft(connectionId: string): Promise<Version | null> {
  return shapeVersion(await versionRepository.currentDraft(connectionId));
}

async function extractionFor(connectionId: string, version?: Version | null): Promise<Extraction | null> {
  const row = version
    ? await versionRepository.versionExtraction(connectionId, version.id)
    : await versionRepository.latestExtraction(connectionId);
  return shapeExtraction(row);
}

async function statusByConnection(connectionIds: string[]): Promise<Map<string, ConnectionHeadlines>> {
  if (!connectionIds.length) return new Map();
  const byConnection = new Map<string, ConnectionHeadlines>();
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
export type { DraftPatch, VersionState, ConnectionHeadlines };
