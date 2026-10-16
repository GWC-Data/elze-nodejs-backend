import crypto from 'node:crypto';
import { fail } from '../../tools/AppError';
import { Throttle } from '../../tools/throttle';
import TtlCache from '../../tools/ttlCache';

type DomoPayload = any;
type DomoRow = Record<string, any>;
type Dataset = {
  id: string;
  name: any;
  description: any;
  rowCount: number | null;
  columnCount: number | null;
  owner: any;
  lastUpdated: any;
};

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
    [response, text] = await DOMO_THROTTLE.run(host, async () => {
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
      return [res, await res.text()] as [Response, string];
    });
  } catch (err: any) {
    if (err && err.code === 'RATE_LIMITED') throw err;
    const reason =
      err.name === 'TimeoutError' ? `it did not respond within ${REQUEST_TIMEOUT_MS / 1000} seconds` : err.message;
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
    const detail = (payload && (payload.message || payload.error)) || text.slice(0, 200) || 'no detail';
    throw Object.assign(fail('CONNECTOR_UNREACHABLE', `${host} answered ${response.status} for ${path}: ${detail}`), {
      upstreamStatus: response.status,
    });
  }

  return payload;
}

async function verify({
  host,
  token,
}: {
  host: string;
  token: string;
}): Promise<{ accountId: any; accountName: any; accountEmail: any }> {
  const me = await callDomo(host, token, WHOAMI_PATH);
  return {
    accountId: me && (me.id ?? me.userId ?? null),
    accountName: (me && (me.displayName || me.name || me.emailAddress)) || null,
    accountEmail: (me && (me.emailAddress || me.email)) || null,
  };
}

function shapeDataset(row: DomoRow | null | undefined): Dataset | null {
  if (!row || typeof row !== 'object') return null;
  const id = row.id ?? row.datasourceId ?? row.dataSourceId;
  if (!id) return null;

  const owner =
    row.owner && typeof row.owner === 'object'
      ? row.owner.name || row.owner.displayName || null
      : row.ownerName || null;

  return {
    id: String(id),
    name: row.name || row.displayName || String(id),
    description: row.description || null,
    rowCount: Number.isFinite(Number(row.rowCount)) ? Number(row.rowCount) : null,
    columnCount: Number.isFinite(Number(row.columnCount)) ? Number(row.columnCount) : null,
    owner,
    lastUpdated: row.lastUpdated ?? row.lastTouched ?? null,
  };
}

function extractRows(payload: DomoPayload): any[] | null {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return null;

  for (const key of ['dataSources', 'datasources', 'searchObjects', 'results', 'items']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  const byEntity = payload.searchResultsMap;
  if (byEntity && typeof byEntity === 'object') {
    for (const value of Object.values(byEntity)) {
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
  } catch (err: any) {
    if (err && (err.upstreamStatus === 404 || err.upstreamStatus === 403)) return null;
    throw err;
  }
}

function resolvePageSize(value: unknown): number {
  const size = Math.floor(Number(value));
  return DATASET_PAGE_SIZES.includes(size) ? size : DEFAULT_DATASET_PAGE_SIZE;
}

async function listDatasetPage({
  host,
  token,
  page,
  pageSize,
  search,
  fresh = false,
}: {
  host: string;
  token: string;
  page?: unknown;
  pageSize?: unknown;
  search?: unknown;
  fresh?: boolean;
}): Promise<{
  datasets: Dataset[];
  page: number;
  pageSize: number;
  total: number | null;
  hasMore: boolean;
  cached: boolean;
}> {
  const size = resolvePageSize(pageSize);
  const pageNumber = Math.max(1, Math.floor(Number(page)) || 1);
  const offset = (pageNumber - 1) * size;
  const needle = String(search ?? '')
    .trim()
    .slice(0, MAX_DATASET_SEARCH);
  const account = crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);
  const key = `${host}|${account}|${size}|${offset}|${needle.toLowerCase()}`;

  if (!fresh) {
    const hit = DATASET_PAGES.get(key);
    if (hit) return { ...hit, cached: true };
  } else {
    DATASET_PAGES.invalidatePrefix(`${host}|${account}|`);
  }

  if (DATASET_ID_PATTERN.test(needle)) {
    const found = pageNumber === 1 ? await findDatasetById(host, token, needle.toLowerCase()) : null;
    const byId = {
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
  const reported = Number(payload?._metaData?.totalCount);
  const total = Number.isFinite(reported) ? reported : null;
  const result = {
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
  host?: any;
  token?: any;
  limit?: unknown;
} = {}): Promise<{ datasets: Dataset[]; truncated: boolean; limit: number }> {
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

function profileColumns(names: any[], types: any[], rows: any[]): Record<string, any>[] {
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
      .filter((v: any) => v && String(v.status || '').toLowerCase() === 'success')
      .map((v: any) => Number(v.sizeBytes))
      .filter((n: number) => Number.isFinite(n) && n >= 0);
    return sizes.length ? sizes.reduce((total: number, n: number) => total + n, 0) : null;
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
}): Promise<Record<string, any>> {
  const detail = await callDomo(host, token, datasetDetailPath(datasetId));
  const reportedSize = firstFiniteNumber(detail?.sizeInBytes, detail?.dataSourceSize, detail?.sizeBytes);

  const [sample, sizeBytes] = await Promise.all([
    callDomo(host, token, queryExecutePath(datasetId), {
      method: 'POST',
      body: { sql: `SELECT * FROM table LIMIT ${PROFILE_SAMPLE_ROWS}` },
    }),
    reportedSize ?? storedSizeBytes(host, token, datasetId),
  ]);

  const names: any[] = Array.isArray(sample?.columns) ? sample.columns : [];
  const types = (Array.isArray(sample?.metadata) ? sample.metadata : []).map((m: any) => m?.type || null);
  const rows: any[] = Array.isArray(sample?.rows) ? sample.rows : [];

  const columns = profileColumns(names, types, rows);
  const rowCount = Number.isFinite(Number(detail && (detail.rowCount ?? detail.rows)))
    ? Number(detail.rowCount ?? detail.rows)
    : null;

  return {
    id: String(datasetId),
    datasetId: String(datasetId),
    name: (detail && (detail.name || detail.displayName)) || String(datasetId),
    description: detail?.description || null,
    rowCount,
    columnCount: Number.isFinite(Number(detail?.columnCount)) ? Number(detail.columnCount) : columns.length || null,
    sizeBytes,
    qualityScore: null,
    lastRefreshedAt: (detail && (detail.lastTouched ?? detail.lastUpdated ?? detail.updatedAt)) || null,
    owner:
      detail?.owner && typeof detail.owner === 'object'
        ? detail.owner.name || detail.owner.displayName || null
        : detail?.ownerName || null,
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
