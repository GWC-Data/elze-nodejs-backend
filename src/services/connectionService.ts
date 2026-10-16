import crypto from 'node:crypto';
import * as connectionRepository from '../repositories/connectionRepository';
import * as contextRepository from '../repositories/contextRepository';
import { fail } from '../tools/AppError';
import { seal, open, hint } from '../tools/secretBox';
import { requireString } from '../validators/commonValidator';
import { cleanDatasetSelection } from '../validators/contextValidator';
import {
  shapeConnection,
  shapeSelected,
  publishedVersionOption,
} from '../views/serializers/connectionSerializer';
import * as domo from './providers/domoProvider';
import { CONNECTION_STATUS } from '../constants/statuses';
import { UNIQUE_VIOLATION } from '../constants/pgErrors';
import { sqlState } from '../tools/dbError';
import { MAX_CONTEXTS_PAGE, MAX_SEARCH_LENGTH } from '../constants/pagination';
import { pageOf } from '../tools/pagination';
import { accessOf, assertLevel, isContextAdmin } from './contextAccessService';
import type { ContextAccess } from './contextAccessService';
import type { ContextAccessLevel } from '../constants/context';
import type { Actor } from '../types/actor';

type Row = Record<string, any>;

const PROVIDERS: Record<string, any> = { domo };

const NOT_FOUND = 'Connection not found';

function providerFor(id: unknown): any {
  const provider = PROVIDERS[String(id || '').trim().toLowerCase()];
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

async function listConnections(actor: Actor): Promise<any[]> {
  const rows = await connectionRepository.listForActor(actor, isContextAdmin(actor));
  return rows.map((row: Row) => shapeConnection(row, undefined, accessOf(actor, row)));
}

async function factTotals(actor: Actor): Promise<{ factsGenerated: number | null; factsPending: number | null }> {
  try {
    const rows = await connectionRepository.listForActor(actor, isContextAdmin(actor));
    return await contextRepository.factTotals(rows.map((row: Row) => String(row.id)));
  } catch {
    return { factsGenerated: null, factsPending: null };
  }
}

async function listPublishedConnections(actor: Actor): Promise<{ id: any; name: any }[]> {
  const rows = await connectionRepository.listPublished(actor, isContextAdmin(actor));
  return rows.map((row: Row) => ({ id: row.id, name: row.name }));
}

async function listPublishedVersionOptions(actor: Actor): Promise<any[]> {
  const rows = await connectionRepository.listPublishedVersions(actor, isContextAdmin(actor));
  return rows.map(publishedVersionOption);
}

async function loadRow(actor: Actor, id: unknown, required: ContextAccessLevel = 'view'): Promise<Row> {
  assertIdShape(id);
  const row = await connectionRepository.findWithSecret(actor, id);
  if (!row) throw fail('RESOURCE_NOT_FOUND', NOT_FOUND);
  return { ...row, access: assertLevel(actor, row, required, NOT_FOUND) };
}

async function selectedDatasets(connectionId: string): Promise<any[]> {
  const rows = await connectionRepository.selectedDatasets(connectionId);
  return rows.map(shapeSelected);
}

async function requireConnectionId(
  actor: Actor,
  id: unknown,
  required: ContextAccessLevel = 'view'
): Promise<{ id: any; name: string; companyId: number; access: ContextAccess; row: Row }> {
  assertIdShape(id);
  const row = await connectionRepository.findId(actor, id);
  if (!row) throw fail('RESOURCE_NOT_FOUND', NOT_FOUND);
  const access = assertLevel(actor, row, required, NOT_FOUND);
  return { id: row.id, name: row.name, companyId: Number(row.company_id), access, row };
}

async function requireConnection(actor: Actor, id: unknown, required: ContextAccessLevel = 'view'): Promise<any> {
  const row = await loadRow(actor, id, required);
  return shapeConnection(row, await selectedDatasets(row.id), row.access);
}

async function profileOverview(actor: Actor, id: unknown, { datasets }: { datasets?: any[] } = {}): Promise<Record<string, any>> {
  const row = await loadRow(actor, id);
  const selected = datasets || (await selectedDatasets(row.id));

  return {
    datasets: selected.map((dataset: any) => ({
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
    profiledAt: selected.reduce(
      (latest: any, d: any) => (!latest || d.selectedAt > latest ? d.selectedAt : latest),
      null
    ),
  };
}

async function openToken(row: Row): Promise<string> {
  try {
    return open(row.secret);
  } catch {
    await connectionRepository.markStatus(row.id, CONNECTION_STATUS.INVALID, 'The stored credential could not be decrypted.');
    throw fail(
      'CONNECTOR_AUTH_FAILED',
      'The stored token for this connection could not be read. It has to be entered again.'
    );
  }
}

async function callWarehouse<T>(row: Row, work: (token: string) => Promise<T>): Promise<T> {
  const token = await openToken(row);
  try {
    const result = await work(token);
    await connectionRepository.markStatus(row.id, CONNECTION_STATUS.CONNECTED, null);
    return result;
  } catch (err: any) {
    if (err.code === 'CONNECTOR_AUTH_FAILED') {
      await connectionRepository.markStatus(row.id, CONNECTION_STATUS.INVALID, err.message);
    }
    throw err;
  }
}

async function tableProfile(actor: Actor, id: unknown, tableId: unknown): Promise<any> {
  const row = await loadRow(actor, id);
  const impl = providerFor(row.provider);

  if (typeof impl.getTableProfile !== 'function') {
    throw fail('VALIDATION_ERROR', `The ${row.provider} connector cannot profile tables yet.`);
  }

  const selected = await selectedDatasets(row.id);
  if (!selected.some((dataset: any) => dataset.id === String(tableId))) {
    throw fail(
      'RESOURCE_NOT_FOUND',
      'That table is not part of this connection\'s selected datasets.'
    );
  }

  return callWarehouse(row, (token) =>
    impl.getTableProfile({ host: row.host, token, datasetId: String(tableId) })
  );
}

async function createConnection(actor: Actor, companyId: number, { provider, name, host, token, limit }: { provider: string; name: unknown; host: unknown; token: unknown; limit?: number }): Promise<Record<string, any>> {
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
  } catch (err: any) {
    if (sqlState(err) === UNIQUE_VIOLATION) {
      throw fail('CONFLICT', `This company already has a ${providerId} connection called "${cleanName}".`);
    }
    throw err;
  }

  const row = await loadRow(actor, id);
  return {
    connection: shapeConnection(row, [], row.access),
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
): Promise<any> {
  const row = await loadRow(actor, id);
  const impl = providerFor(row.provider);
  return callWarehouse(row, (token) =>
    impl.listDatasetPage({ host: row.host, token, page, pageSize, search, fresh })
  );
}

async function verifyConnection(actor: Actor, id: unknown): Promise<{ connection: any; account: any }> {
  const row = await loadRow(actor, id, 'edit');
  const impl = providerFor(row.provider);
  const account = await callWarehouse(row, (token) => impl.verify({ host: row.host, token }));
  return { connection: await requireConnection(actor, id), account };
}

async function replaceSelection(actor: Actor, id: unknown, datasets: unknown): Promise<any> {
  const row = await loadRow(actor, id, 'edit');
  const clean = cleanDatasetSelection(datasets);
  await connectionRepository.replaceSelection(row.id, clean, actor.id);
  return requireConnection(actor, id);
}

async function deleteConnection(actor: Actor, id: unknown): Promise<{ provider: any; name: any; companyId: any }> {
  const row = await loadRow(actor, id, 'full');
  await connectionRepository.remove(row.id);
  return { provider: row.provider, name: row.name, companyId: row.company_id ?? null };
}

async function listDraftConnections(actor: Actor, query: Record<string, unknown> = {}) {
  const search = String(query.search || '').trim().slice(0, MAX_SEARCH_LENGTH);
  const { page, pageSize, offset } = pageOf(query, 10, MAX_CONTEXTS_PAGE);
  const { rows, total } = await connectionRepository.listDrafts(actor, isContextAdmin(actor), {
    search,
    offset,
    limit: pageSize,
  });
  return {
    items: rows.map((row: Row) => ({
      ...shapeConnection(row, undefined, accessOf(actor, row)),
      draft: row.draft_version === null || row.draft_version === undefined
        ? null
        : {
            name: row.draft_name,
            version: Number(row.draft_version),
            label: `v${row.draft_version}`,
            step: row.draft_step || null,
            updatedAt: row.draft_updated_at,
          },
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
