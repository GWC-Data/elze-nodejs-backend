import crypto from 'node:crypto';
import * as connectionRepository from './connectionRepository';
import * as contextRepository from './contextRepository';
import { fail } from '../../shared/errors/AppError';
import { seal, open, hint } from '../../shared/security/secretBox';
import { requireString } from '../../shared/validation/commonValidator';
import { cleanDatasetSelection } from './contextValidator';
import { shapeConnection, shapeSelected, publishedVersionOption } from './connectionSerializer';
import type { PublishedVersionOption, SelectedDataset, ShapedConnection } from './connectionSerializer';
import * as domo from './domoProvider';
import type { Dataset, DatasetPage, DatasetPageRequest, TableProfile, WarehouseAccount } from './domoProvider';
import { CONNECTION_STATUS } from '../../shared/db/statuses';
import { UNIQUE_VIOLATION } from '../../shared/errors/pgErrors';
import { sqlState } from '../../shared/db/dbError';
import { MAX_CONTEXTS_PAGE, MAX_SEARCH_LENGTH } from '../../shared/validation/pageLimits';
import { pageOf } from '../../shared/validation/pagination';
import { accessOf, assertLevel, isContextAdmin } from './contextAccessService';
import type { ContextAccess } from './contextAccessService';
import type { ContextAccessLevel } from './contextConstants';
import type { ConnectionIdRow, ConnectionSecretRow, DraftConnectionRow } from './connectionRepository';
import type { Actor } from '../../shared/types/actor';
import type { ContextStep } from '../../generated/prisma/enums';
import { entry } from './contextTypes';
import type { DatasetFields, RequestQuery } from './contextTypes';

interface WarehouseProvider {
  normaliseHost(input: unknown): string;
  verify(credentials: { host: string; token: string }): Promise<WarehouseAccount>;
  listDatasets(request: { host: string; token: string; limit?: unknown }): Promise<{
    datasets: Dataset[];
    truncated: boolean;
    limit: number;
  }>;
  listDatasetPage(request: DatasetPageRequest): Promise<DatasetPage>;
  getTableProfile?(request: { host: string; token: string; datasetId: string }): Promise<TableProfile>;
}

type ConnectionView = ShapedConnection<SelectedDataset[], ContextAccess>;
type ListedConnection = ShapedConnection<undefined, ContextAccess | undefined>;
type LoadedConnection = ConnectionSecretRow & { access: ContextAccess };

interface ConnectionRef {
  id: string;
  name: string;
  companyId: number;
  access: ContextAccess;
  row: ConnectionIdRow;
}

interface DraftSummary {
  name: string | null;
  version: number;
  label: string;
  step: ContextStep | null;
  updatedAt: Date | null;
}

interface CreatedConnection {
  connection: ConnectionView;
  account: WarehouseAccount;
  datasets: Dataset[];
  truncated: boolean;
  limit: number;
}

interface ProfileOverview {
  datasets: {
    datasetId: unknown;
    name: unknown;
    tableCount: number;
    tables: { id: unknown; datasetId: unknown; name: unknown; rowCount: unknown; columnCount: unknown }[];
  }[];
  profiledAt: unknown;
}

const PROVIDERS: Record<string, WarehouseProvider> = { domo };

const NOT_FOUND = 'Connection not found';

function providerFor(id: unknown): WarehouseProvider {
  const provider =
    PROVIDERS[
      String(id || '')
        .trim()
        .toLowerCase()
    ];
  if (!provider) {
    throw fail('VALIDATION_ERROR', `"${id}" is not a connector that can be configured yet.`);
  }
  return provider;
}

function assertIdShape(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !id.trim()) {
    throw fail('RESOURCE_NOT_FOUND', NOT_FOUND);
  }
}

function isLater(value: unknown, than: NonNullable<unknown>): boolean {
  return value !== null && value !== undefined && value > than;
}

async function listConnections(actor: Actor): Promise<ListedConnection[]> {
  const rows = await connectionRepository.listForActor(actor, isContextAdmin(actor));
  return rows.map((row) => shapeConnection(row, undefined, accessOf(actor, row) ?? undefined));
}

async function factTotals(actor: Actor): Promise<{ factsGenerated: number | null; factsPending: number | null }> {
  try {
    const rows = await connectionRepository.listForActor(actor, isContextAdmin(actor));
    return await contextRepository.factTotals(rows.map((row) => String(row.id)));
  } catch {
    return { factsGenerated: null, factsPending: null };
  }
}

async function listPublishedConnections(actor: Actor): Promise<{ id: string; name: string }[]> {
  const rows = await connectionRepository.listPublished(actor, isContextAdmin(actor));
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

async function listPublishedVersionOptions(actor: Actor): Promise<PublishedVersionOption[]> {
  const rows = await connectionRepository.listPublishedVersions(actor, isContextAdmin(actor));
  return rows.map(publishedVersionOption);
}

async function loadRow(actor: Actor, id: unknown, required: ContextAccessLevel = 'view'): Promise<LoadedConnection> {
  assertIdShape(id);
  const row = await connectionRepository.findWithSecret(actor, id);
  if (!row) throw fail('RESOURCE_NOT_FOUND', NOT_FOUND);
  return { ...row, access: assertLevel(actor, row, required, NOT_FOUND) };
}

async function selectedDatasets(connectionId: string): Promise<SelectedDataset[]> {
  const rows = await connectionRepository.selectedDatasets(connectionId);
  return rows.map(shapeSelected);
}

async function requireConnectionId(
  actor: Actor,
  id: unknown,
  required: ContextAccessLevel = 'view'
): Promise<ConnectionRef> {
  assertIdShape(id);
  const row = await connectionRepository.findId(actor, id);
  if (!row) throw fail('RESOURCE_NOT_FOUND', NOT_FOUND);
  const access = assertLevel(actor, row, required, NOT_FOUND);
  return { id: row.id, name: row.name, companyId: Number(row.company_id), access, row };
}

async function requireConnection(
  actor: Actor,
  id: unknown,
  required: ContextAccessLevel = 'view'
): Promise<ConnectionView> {
  const row = await loadRow(actor, id, required);
  return shapeConnection(row, await selectedDatasets(row.id), row.access);
}

async function profileOverview(
  actor: Actor,
  id: unknown,
  { datasets }: { datasets?: readonly DatasetFields[] } = {}
): Promise<ProfileOverview> {
  const row = await loadRow(actor, id);
  const selected: readonly DatasetFields[] = datasets || (await selectedDatasets(row.id));

  return {
    datasets: selected.map((dataset) => ({
      datasetId: dataset.id,
      name: dataset.name || dataset.id,
      tableCount: 1,
      tables: [
        {
          id: dataset.id,
          datasetId: dataset.id,
          name: dataset.name || dataset.id,
          rowCount: dataset.rowCount,
          columnCount: dataset.columnCount,
        },
      ],
    })),
    profiledAt: selected.reduce<unknown>(
      (latest, d) => (!latest || isLater(d.selectedAt, latest) ? d.selectedAt : latest),
      null
    ),
  };
}

async function openToken(row: { id: string; secret: string }): Promise<string> {
  try {
    return open(row.secret);
  } catch {
    await connectionRepository.markStatus(
      row.id,
      CONNECTION_STATUS.INVALID,
      'The stored credential could not be decrypted.'
    );
    throw fail(
      'CONNECTOR_AUTH_FAILED',
      'The stored token for this connection could not be read. It has to be entered again.'
    );
  }
}

async function callWarehouse<T>(row: { id: string; secret: string }, work: (token: string) => Promise<T>): Promise<T> {
  const token = await openToken(row);
  try {
    const result = await work(token);
    await connectionRepository.markStatus(row.id, CONNECTION_STATUS.CONNECTED, null);
    return result;
  } catch (err) {
    if (entry(err, 'code') === 'CONNECTOR_AUTH_FAILED') {
      await connectionRepository.markStatus(row.id, CONNECTION_STATUS.INVALID, String(entry(err, 'message')));
    }
    throw err;
  }
}

async function tableProfile(actor: Actor, id: unknown, tableId: unknown): Promise<TableProfile> {
  const row = await loadRow(actor, id);
  const impl = providerFor(row.provider);

  const getTableProfile = impl.getTableProfile?.bind(impl);
  if (typeof getTableProfile !== 'function') {
    throw fail('VALIDATION_ERROR', `The ${row.provider} connector cannot profile tables yet.`);
  }

  const selected = await selectedDatasets(row.id);
  if (!selected.some((dataset) => dataset.id === String(tableId))) {
    throw fail('RESOURCE_NOT_FOUND', "That table is not part of this connection's selected datasets.");
  }

  return callWarehouse(row, (token) => getTableProfile({ host: row.host, token, datasetId: String(tableId) }));
}

async function createConnection(
  actor: Actor,
  companyId: number,
  {
    provider,
    name,
    host,
    token,
    limit,
  }: { provider: string; name: unknown; host: unknown; token: unknown; limit?: number }
): Promise<CreatedConnection> {
  const impl = providerFor(provider);
  const providerId = String(provider).trim().toLowerCase();

  const cleanName = requireString(name, 'Connection name', { min: 2, max: 120 });
  const cleanHost = impl.normaliseHost(host);
  const cleanToken = String(token || '').trim();
  if (!cleanToken) {
    throw fail('VALIDATION_ERROR', 'The access token is required.');
  }

  const account = await impl.verify({ host: cleanHost, token: cleanToken });
  const listing = await impl.listDatasets({ host: cleanHost, token: cleanToken, limit });

  const id = crypto.randomUUID();
  try {
    await connectionRepository.insert({
      id,
      companyId,
      provider: providerId,
      name: cleanName,
      host: cleanHost,
      secret: seal(cleanToken),
      secretHint: hint(cleanToken),
      createdBy: actor.id,
    });
  } catch (err) {
    if (sqlState(err) === UNIQUE_VIOLATION) {
      throw fail('CONFLICT', `This company already has a ${providerId} connection called "${cleanName}".`);
    }
    throw err;
  }

  const row = await loadRow(actor, id);
  const none: SelectedDataset[] = [];
  return {
    connection: shapeConnection(row, none, row.access),
    account,
    datasets: listing.datasets,
    truncated: listing.truncated,
    limit: listing.limit,
  };
}

async function fetchDatasetPage(
  actor: Actor,
  id: unknown,
  { page, pageSize, search, fresh }: { page?: unknown; pageSize?: unknown; search?: unknown; fresh?: boolean } = {}
): Promise<DatasetPage> {
  const row = await loadRow(actor, id);
  const impl = providerFor(row.provider);
  return callWarehouse(row, (token) => impl.listDatasetPage({ host: row.host, token, page, pageSize, search, fresh }));
}

async function verifyConnection(
  actor: Actor,
  id: unknown
): Promise<{ connection: ConnectionView; account: WarehouseAccount }> {
  const row = await loadRow(actor, id, 'edit');
  const impl = providerFor(row.provider);
  const account = await callWarehouse(row, (token) => impl.verify({ host: row.host, token }));
  return { connection: await requireConnection(actor, id), account };
}

async function replaceSelection(actor: Actor, id: unknown, datasets: unknown): Promise<ConnectionView> {
  const row = await loadRow(actor, id, 'edit');
  const clean = cleanDatasetSelection(datasets);
  await connectionRepository.replaceSelection(row.id, clean, actor.id);
  return requireConnection(actor, id);
}

async function deleteConnection(
  actor: Actor,
  id: unknown
): Promise<{ provider: string; name: string; companyId: number | null }> {
  const row = await loadRow(actor, id, 'full');
  await connectionRepository.remove(row.id);
  return { provider: row.provider, name: row.name, companyId: row.company_id ?? null };
}

function draftOf(row: DraftConnectionRow): DraftSummary | null {
  return row.draft_version === null || row.draft_version === undefined
    ? null
    : {
        name: row.draft_name,
        version: Number(row.draft_version),
        label: `v${row.draft_version}`,
        step: row.draft_step || null,
        updatedAt: row.draft_updated_at,
      };
}

async function listDraftConnections(
  actor: Actor,
  query: RequestQuery = {}
): Promise<{
  items: (ListedConnection & { draft: DraftSummary | null })[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const search = String(query.search || '')
    .trim()
    .slice(0, MAX_SEARCH_LENGTH);
  const { page, pageSize, offset } = pageOf(query, 10, MAX_CONTEXTS_PAGE);
  const { rows, total } = await connectionRepository.listDrafts(actor, isContextAdmin(actor), {
    search,
    offset,
    limit: pageSize,
  });
  return {
    items: rows.map((row) => ({
      ...shapeConnection(row, undefined, accessOf(actor, row) ?? undefined),
      draft: draftOf(row),
    })),
    total,
    page,
    pageSize,
  };
}

export {
  listConnections,
  listDraftConnections,
  factTotals,
  listPublishedConnections,
  listPublishedVersionOptions,
  requireConnection,
  requireConnectionId,
  createConnection,
  fetchDatasetPage,
  profileOverview,
  tableProfile,
  verifyConnection,
  replaceSelection,
  deleteConnection,
};
export type { WarehouseProvider, ConnectionView, ListedConnection, ConnectionRef, DraftSummary, ProfileOverview };
