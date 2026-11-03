import crypto from 'node:crypto';
import { fail } from '../../shared/errors/AppError';
import { Throttle } from './throttle';
import TtlCache from '../../shared/cache/ttlCache';
import { entry, field, strictField } from './contextTypes';
import type { JsonValue } from './contextTypes';

type DomoPayload = JsonValue;

interface Dataset {
  id: string;
  name: JsonValue;
  description: JsonValue;
  rowCount: number | null;
  columnCount: number | null;
  owner: JsonValue;
  lastUpdated: JsonValue;
}

interface WarehouseAccount {
  accountId: JsonValue;
  accountName: JsonValue;
  accountEmail: JsonValue;
}

interface DatasetPageRequest {
  host: string;
  token: string;
  page?: unknown;
  pageSize?: unknown;
  search?: unknown;
  fresh?: boolean;
}

interface DatasetPageBody {
  datasets: Dataset[];
  page: number;
  pageSize: number;
  total: number | null;
  hasMore: boolean;
}

interface DatasetPage extends DatasetPageBody {
  cached: boolean;
}

interface ColumnProfile {
  name: JsonValue;
  dataType: JsonValue;
  nullable: null;
  nullPercent: number | null;
  uniqueCount: number | null;
  semanticType: null;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  min: number | null;
  max: number | null;
  distribution: null;
}

interface TableProfile {
  id: string;
  datasetId: string;
  name: JsonValue;
  description: JsonValue;
  rowCount: number | null;
  columnCount: number | null;
  sizeBytes: number | null;
  qualityScore: null;
  lastRefreshedAt: JsonValue;
  owner: JsonValue;
  columns: ColumnProfile[];
  sample: { columns: JsonValue[]; rows: JsonValue[]; sampledFrom: number | null } | null;
  statsSampleSize: number;
  qualityIssues: unknown[];
}

const WHOAMI_PATH = '/api/content/v2/users/me';

const DATASET_LIST_PATH = '/api/data/v3/datasources';

const datasetDetailPath = (datasetId: string): string => `/api/data/v3/datasources/${encodeURIComponent(datasetId)}`;

const queryExecutePath = (datasetId: string): string => `/api/query/v1/execute/${encodeURIComponent(datasetId)}`;

const dataVersionsPath = (datasetId: string): string =>
  `/api/data/v3/datasources/${encodeURIComponent(datasetId)}/dataversions/details`;

const PROFILE_SAMPLE_ROWS = 500;

const SAMPLE_ROWS_SHOWN = 20;

const PAGE_SIZE = 50;

const MAX_PAGES = 100;
const REQUEST_TIMEOUT_MS = 20000;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = MAX_PAGES * PAGE_SIZE;

const DATASET_PAGE_SIZES = [10, 25, 50];
const DEFAULT_DATASET_PAGE_SIZE = 25;
const MAX_DATASET_SEARCH = 100;
const DATASET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DOMO_THROTTLE = new Throttle({ concurrent: 2, gapMs: 250, maxWaiting: 20 });
const DATASET_PAGES = new TtlCache(2 * 60 * 1000);

const DATASET_PARTS = [
  'core',
  'permission',
  'status',
  'pdp',
  'rowcolcount',
  'certification',
  'sharecount',
  'alertcount',
  'dataprovider',
  'features',
  'impactcounts',
  'functions',
  'cryo',
  'warnings',
  'pharos',
].join(',');

function datasetPageQuery(offset: number, pageSize: number, search = ''): string {
  return (
    `?limit=${pageSize}` +
    `&offset=${offset}` +
    `&part=${DATASET_PARTS}` +
    '&includeHidden=true' +
    '&orderBy=createdAt' +
    (search ? `&nameLike=${encodeURIComponent(search)}` : '')
  );
}

function resolveLimit(limit: unknown): number {
  const value = Math.floor(Number(limit));
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_LIMIT;
  return Math.min(value, MAX_LIMIT);
}

function normaliseHost(input: unknown): string {
  let value = String(input || '')
    .trim()
    .toLowerCase();
  if (!value) {
    throw fail('VALIDATION_ERROR', 'The Domo instance is required, for example acme.domo.com');
  }

  value = value
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
  if (!value.includes('.')) value = `${value}.domo.com`;

  if (!/^[a-z0-9][a-z0-9.-]{1,188}$/.test(value) || !value.endsWith('.domo.com')) {
    throw fail('VALIDATION_ERROR', `"${input}" is not a Domo instance address. It looks like acme.domo.com.`);
  }
  return value;
}

async function callDomo(
  host: string,
  token: string,
  path: string,
  { method = 'GET', body }: { method?: string; body?: unknown } = {}
): Promise<DomoPayload> {
  const url = `https://${host}${path}`;

  let response: Response;
  let text: string;
  try {
    [response, text] = await DOMO_THROTTLE.run<[Response, string]>(host, async () => {
      const res = await fetch(url, {
        method,
        headers: {
          'X-DOMO-Developer-Token': token,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return [res, await res.text()];
    });
  } catch (err) {
    if (err && entry(err, 'code') === 'RATE_LIMITED') throw err;
    const reason =
      entry(err, 'name') === 'TimeoutError'
        ? `it did not respond within ${REQUEST_TIMEOUT_MS / 1000} seconds`
        : entry(err, 'message');
    throw fail('CONNECTOR_UNREACHABLE', `Could not reach ${host}: ${reason}`);
  }

  let payload: DomoPayload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {}
  }

  if (response.status === 401 || response.status === 403) {
    throw Object.assign(
      fail(
        'CONNECTOR_AUTH_FAILED',
        `${host} rejected that access token. Check it has not been revoked or expired, ` +
          'and that it was issued by this instance.'
      ),
      { upstreamStatus: response.status }
    );
  }

  if (!response.ok) {
    const detail =
      (payload && (field(payload, 'message') || field(payload, 'error'))) || text.slice(0, 200) || 'no detail';
    throw Object.assign(fail('CONNECTOR_UNREACHABLE', `${host} answered ${response.status} for ${path}: ${detail}`), {
      upstreamStatus: response.status,
    });
  }

  return payload;
}

async function verify({ host, token }: { host: string; token: string }): Promise<WarehouseAccount> {
  const me = await callDomo(host, token, WHOAMI_PATH);
  return {
    accountId: me && (field(me, 'id') ?? field(me, 'userId') ?? null),
    accountName: (me && (field(me, 'displayName') || field(me, 'name') || field(me, 'emailAddress'))) || null,
    accountEmail: (me && (field(me, 'emailAddress') || field(me, 'email'))) || null,
  };
}

function shapeDataset(row: JsonValue | undefined): Dataset | null {
  if (!row || typeof row !== 'object') return null;
  const id = field(row, 'id') ?? field(row, 'datasourceId') ?? field(row, 'dataSourceId');
  if (!id) return null;

  const rowOwner = field(row, 'owner');
  const owner =
    rowOwner && typeof rowOwner === 'object'
      ? field(rowOwner, 'name') || field(rowOwner, 'displayName') || null
      : field(row, 'ownerName') || null;

  return {
    id: String(id),
    name: field(row, 'name') || field(row, 'displayName') || String(id),
    description: field(row, 'description') || null,
    rowCount: Number.isFinite(Number(field(row, 'rowCount'))) ? Number(field(row, 'rowCount')) : null,
    columnCount: Number.isFinite(Number(field(row, 'columnCount'))) ? Number(field(row, 'columnCount')) : null,
    owner,
    lastUpdated: field(row, 'lastUpdated') ?? field(row, 'lastTouched') ?? null,
  };
}

function extractRows(payload: DomoPayload): JsonValue[] | null {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return null;

  for (const key of ['dataSources', 'datasources', 'searchObjects', 'results', 'items']) {
    const rows = payload[key];
    if (Array.isArray(rows)) return rows;
  }
  const byEntity = payload.searchResultsMap;
  if (byEntity && typeof byEntity === 'object') {
    const groups: (JsonValue | undefined)[] = Object.values(byEntity);
    for (const value of groups) {
      if (Array.isArray(value)) return value;
    }
  }
  return null;
}

function unrecognised(host: string, payload: DomoPayload): Error {
  const shape =
    payload && typeof payload === 'object' ? Object.keys(payload).join(', ') || '(no keys)' : typeof payload;
  console.error(
    `[domo] unrecognised response from ${DATASET_LIST_PATH} - keys: ${shape}
` + `[domo] sample: ${JSON.stringify(payload).slice(0, 600)}`
  );
  return fail(
    'CONNECTOR_UNREACHABLE',
    `${host} answered ${DATASET_LIST_PATH} with something this connector does not ` +
      `recognise (fields: ${shape}). The instance API may have changed - the server log ` +
      'has the response, and services/providers/domoProvider.ts is the only file that needs to change.'
  );
}

async function findDatasetById(host: string, token: string, datasetId: string): Promise<Dataset | null> {
  try {
    return shapeDataset(await callDomo(host, token, `${datasetDetailPath(datasetId)}?part=core,rowcolcount`));
  } catch (err) {
    if (err && (entry(err, 'upstreamStatus') === 404 || entry(err, 'upstreamStatus') === 403)) return null;
    throw err;
  }
}

function resolvePageSize(value: unknown): number {
  const size = Math.floor(Number(value));
  return DATASET_PAGE_SIZES.includes(size) ? size : DEFAULT_DATASET_PAGE_SIZE;
}

function isCachedPage(value: unknown): value is DatasetPageBody {
  return typeof value === 'object' && value !== null && 'datasets' in value;
}

async function listDatasetPage({
  host,
  token,
  page,
  pageSize,
  search,
  fresh = false,
}: DatasetPageRequest): Promise<DatasetPage> {
  const size = resolvePageSize(pageSize);
  const pageNumber = Math.max(1, Math.floor(Number(page)) || 1);
  const offset = (pageNumber - 1) * size;
  const needle = String(search ?? '')
    .trim()
    .slice(0, MAX_DATASET_SEARCH);
  const account = crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);
  const key = `${host}|${account}|${size}|${offset}|${needle.toLowerCase()}`;

  if (!fresh) {
    const hit: unknown = DATASET_PAGES.get(key);
    if (isCachedPage(hit)) return { ...hit, cached: true };
  } else {
    DATASET_PAGES.invalidatePrefix(`${host}|${account}|`);
  }

  if (DATASET_ID_PATTERN.test(needle)) {
    const found = pageNumber === 1 ? await findDatasetById(host, token, needle.toLowerCase()) : null;
    const byId: DatasetPageBody = {
      datasets: found ? [found] : [],
      page: pageNumber,
      pageSize: size,
      total: found ? 1 : 0,
      hasMore: false,
    };
    DATASET_PAGES.set(key, byId);
    return { ...byId, cached: false };
  }

  const payload = await callDomo(host, token, DATASET_LIST_PATH + datasetPageQuery(offset, size, needle));
  const rows = extractRows(payload);
  if (rows === null) throw unrecognised(host, payload);

  const datasets = rows.map(shapeDataset).filter((d): d is Dataset => d !== null);
  const reported = Number(field(field(payload, '_metaData'), 'totalCount'));
  const total = Number.isFinite(reported) ? reported : null;
  const result: DatasetPageBody = {
    datasets,
    page: pageNumber,
    pageSize: size,
    total,
    hasMore: total !== null ? offset + datasets.length < total : datasets.length === size,
  };
  DATASET_PAGES.set(key, result);
  return { ...result, cached: false };
}

async function listDatasets({
  host,
  token,
  limit,
}: {
  host: string;
  token: string;
  limit?: unknown;
}): Promise<{ datasets: Dataset[]; truncated: boolean; limit: number }> {
  const target = resolveLimit(limit);
  const ceiling = target + 1;
  const datasets: Dataset[] = [];
  const seen = new Set<string>();
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const remaining = ceiling - datasets.length;
    if (remaining <= 0) break;

    const pageSize = Math.min(PAGE_SIZE, remaining);
    const payload = await callDomo(host, token, DATASET_LIST_PATH + datasetPageQuery(offset, pageSize));

    const rows = extractRows(payload);
    if (rows === null) throw unrecognised(host, payload);

    offset += rows.length;

    let added = 0;
    for (const row of rows) {
      const dataset = shapeDataset(row);
      if (!dataset || seen.has(dataset.id)) continue;
      if (datasets.length >= ceiling) break;

      seen.add(dataset.id);
      datasets.push(dataset);
      added++;
    }

    if (rows.length < pageSize || added === 0) break;
  }

  const truncated = datasets.length > target;
  if (truncated) datasets.length = target;

  datasets.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { datasets, truncated, limit: target };
}

function isNumericType(domoType: unknown): boolean {
  return ['LONG', 'DOUBLE', 'DECIMAL', 'INTEGER', 'FLOAT', 'NUMBER'].includes(String(domoType || '').toUpperCase());
}

function profileColumns(names: JsonValue[], types: JsonValue[], rows: JsonValue[]): ColumnProfile[] {
  const sampleSize = rows.length;

  return names.map((name, index) => {
    const type = types[index] ?? null;
    const values = rows.map((row) => (Array.isArray(row) ? row[index] : undefined));
    const present = values.filter((v) => v !== null && v !== undefined);
    const distinct = new Set(present.map((v) => String(v)));

    let min: number | null = null;
    let max: number | null = null;
    if (isNumericType(type)) {
      const numbers = present.map(Number).filter((n) => Number.isFinite(n));
      if (numbers.length) {
        min = Math.min(...numbers);
        max = Math.max(...numbers);
      }
    }

    return {
      name,
      dataType: type ?? 'UNKNOWN',
      nullable: null,
      nullPercent: sampleSize ? ((sampleSize - present.length) / sampleSize) * 100 : null,
      uniqueCount: sampleSize ? distinct.size : null,
      semanticType: null,
      isPrimaryKey: false,
      isForeignKey: false,
      min,
      max,
      distribution: null,
    };
  });
}

async function storedSizeBytes(host: string, token: string, datasetId: string): Promise<number | null> {
  try {
    const versions = await callDomo(host, token, dataVersionsPath(datasetId));
    if (!Array.isArray(versions)) return null;
    const sizes = versions
      .filter((v) => v && String(field(v, 'status') || '').toLowerCase() === 'success')
      .map((v) => Number(field(v, 'sizeBytes')))
      .filter((n) => Number.isFinite(n) && n >= 0);
    return sizes.length ? sizes.reduce((total, n) => total + n, 0) : null;
  } catch {
    return null;
  }
}

async function getTableProfile({
  host,
  token,
  datasetId,
}: {
  host: string;
  token: string;
  datasetId: string;
}): Promise<TableProfile> {
  const detail = await callDomo(host, token, datasetDetailPath(datasetId));
  const reportedSize = firstFiniteNumber(
    field(detail, 'sizeInBytes'),
    field(detail, 'dataSourceSize'),
    field(detail, 'sizeBytes')
  );

  const [sample, sizeBytes] = await Promise.all([
    callDomo(host, token, queryExecutePath(datasetId), {
      method: 'POST',
      body: { sql: `SELECT * FROM table LIMIT ${PROFILE_SAMPLE_ROWS}` },
    }),
    reportedSize ?? storedSizeBytes(host, token, datasetId),
  ]);

  const sampleColumns = field(sample, 'columns');
  const sampleMetadata = field(sample, 'metadata');
  const sampleRows = field(sample, 'rows');
  const names: JsonValue[] = Array.isArray(sampleColumns) ? sampleColumns : [];
  const types = (Array.isArray(sampleMetadata) ? sampleMetadata : []).map((m) => field(m, 'type') || null);
  const rows: JsonValue[] = Array.isArray(sampleRows) ? sampleRows : [];

  const columns = profileColumns(names, types, rows);
  const rowCount = Number.isFinite(Number(detail && (field(detail, 'rowCount') ?? field(detail, 'rows'))))
    ? Number(strictField(detail, 'rowCount') ?? strictField(detail, 'rows'))
    : null;
  const detailOwner = field(detail, 'owner');

  return {
    id: String(datasetId),
    datasetId: String(datasetId),
    name: (detail && (field(detail, 'name') || field(detail, 'displayName'))) || String(datasetId),
    description: field(detail, 'description') || null,
    rowCount,
    columnCount: Number.isFinite(Number(field(detail, 'columnCount')))
      ? Number(field(detail, 'columnCount'))
      : columns.length || null,
    sizeBytes,
    qualityScore: null,
    lastRefreshedAt:
      (detail && (field(detail, 'lastTouched') ?? field(detail, 'lastUpdated') ?? field(detail, 'updatedAt'))) || null,
    owner:
      detailOwner && typeof detailOwner === 'object'
        ? field(detailOwner, 'name') || field(detailOwner, 'displayName') || null
        : field(detail, 'ownerName') || null,
    columns,
    sample: names.length
      ? {
          columns: names,
          rows: rows.slice(0, SAMPLE_ROWS_SHOWN),
          sampledFrom: rowCount,
        }
      : null,
    statsSampleSize: rows.length,
    qualityIssues: [],
  };
}

function firstFiniteNumber(...candidates: unknown[]): number | null {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === '') continue;
    const value = Number(candidate);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

export { DATASET_PAGE_SIZES, normaliseHost, verify, listDatasets, listDatasetPage, getTableProfile };
export type {
  Dataset,
  WarehouseAccount,
  DatasetPageRequest,
  DatasetPageBody,
  DatasetPage,
  ColumnProfile,
  TableProfile,
};
