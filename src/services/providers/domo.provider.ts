import { fail } from '../../tools/AppError';

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

const datasetDetailPath = (datasetId: string): string =>
  `/api/data/v3/datasources/${encodeURIComponent(datasetId)}`;

const queryExecutePath = (datasetId: string): string =>
  `/api/query/v1/execute/${encodeURIComponent(datasetId)}`;

const PROFILE_SAMPLE_ROWS = 500;

const SAMPLE_ROWS_SHOWN = 20;

const PAGE_SIZE = 50;

const MAX_PAGES = 100;
const REQUEST_TIMEOUT_MS = 20000;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = MAX_PAGES * PAGE_SIZE;

const DATASET_PARTS = [
  'core', 'permission', 'status', 'pdp', 'rowcolcount', 'certification',
  'sharecount', 'alertcount', 'dataprovider', 'features', 'impactcounts',
  'functions', 'cryo', 'warnings', 'pharos',
].join(',');

function datasetPageQuery(offset: number, pageSize: number): string {
  return (
    `?limit=${pageSize}` +
    `&offset=${offset}` +
    `&part=${DATASET_PARTS}` +
    '&includeHidden=true' +
    '&orderBy=createdAt'
  );
}

function resolveLimit(limit: unknown): number {
  const value = Math.floor(Number(limit));
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_LIMIT;
  return Math.min(value, MAX_LIMIT);
}

function normaliseHost(input: unknown): string {
  let value = String(input || '').trim().toLowerCase();
  if (!value) {
    throw fail('VALIDATION_ERROR', 'The Domo instance is required, for example acme.domo.com');
  }

  value = value.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
  if (!value.includes('.')) value = `${value}.domo.com`;

  if (!/^[a-z0-9][a-z0-9.-]{1,188}$/.test(value) || !value.endsWith('.domo.com')) {
    throw fail(
      'VALIDATION_ERROR',
      `"${input}" is not a Domo instance address. It looks like acme.domo.com.`
    );
  }
  return value;
}

async function callDomo(host: string, token: string, path: string, { method = 'GET', body }: { method?: string; body?: unknown } = {}): Promise<DomoPayload> {
  const url = `https://${host}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        'X-DOMO-Developer-Token': token,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err: any) {
    const reason = err.name === 'TimeoutError'
      ? `it did not respond within ${REQUEST_TIMEOUT_MS / 1000} seconds`
      : err.message;
    throw fail('CONNECTOR_UNREACHABLE', `Could not reach ${host}: ${reason}`);
  }

  const text = await response.text();
  let payload: DomoPayload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { }
  }

  if (response.status === 401 || response.status === 403) {
    throw fail(
      'CONNECTOR_AUTH_FAILED',
      `${host} rejected that access token. Check it has not been revoked or expired, ` +
      'and that it was issued by this instance.'
    );
  }

  if (!response.ok) {
    const detail = (payload && (payload.message || payload.error)) || text.slice(0, 200) || 'no detail';
    throw fail(
      'CONNECTOR_UNREACHABLE',
      `${host} answered ${response.status} for ${path}: ${detail}`
    );
  }

  return payload;
}

async function verify({ host, token }: { host: string; token: string }): Promise<{ accountId: any; accountName: any; accountEmail: any }> {
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

  const owner = row.owner && typeof row.owner === 'object'
    ? (row.owner.name || row.owner.displayName || null)
    : (row.ownerName || null);

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

async function listDatasets({ host, token, limit }: { host?: any; token?: any; limit?: unknown } = {}): Promise<{ datasets: Dataset[]; truncated: boolean; limit: number }> {
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
    if (rows === null) {
      const shape = payload && typeof payload === 'object'
        ? Object.keys(payload).join(', ') || '(no keys)'
        : typeof payload;
      console.error(
        `[domo] unrecognised response from ${DATASET_LIST_PATH} - keys: ${shape}
` +
        `[domo] sample: ${JSON.stringify(payload).slice(0, 600)}`
      );
      throw fail(
        'CONNECTOR_UNREACHABLE',
        `${host} answered ${DATASET_LIST_PATH} with something this connector does not ` +
        `recognise (fields: ${shape}). The instance API may have changed - the server log ` +
        'has the response, and services/providers/domo.provider.js is the only file that needs to change.'
      );
    }

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
  return ['LONG', 'DOUBLE', 'DECIMAL', 'INTEGER', 'FLOAT', 'NUMBER'].includes(
    String(domoType || '').toUpperCase()
  );
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

async function getTableProfile({ host, token, datasetId }: { host: string; token: string; datasetId: string }): Promise<Record<string, any>> {
  const detail = await callDomo(host, token, datasetDetailPath(datasetId));

  const sample = await callDomo(host, token, queryExecutePath(datasetId), {
    method: 'POST',
    body: { sql: `SELECT * FROM table LIMIT ${PROFILE_SAMPLE_ROWS}` },
  });

  const names: any[] = Array.isArray(sample && sample.columns) ? sample.columns : [];
  const types = (Array.isArray(sample && sample.metadata) ? sample.metadata : []).map(
    (m: any) => (m && m.type) || null
  );
  const rows: any[] = Array.isArray(sample && sample.rows) ? sample.rows : [];

  const columns = profileColumns(names, types, rows);
  const rowCount = Number.isFinite(Number(detail && (detail.rowCount ?? detail.rows)))
    ? Number(detail.rowCount ?? detail.rows)
    : null;

  return {
    id: String(datasetId),
    datasetId: String(datasetId),
    name: (detail && (detail.name || detail.displayName)) || String(datasetId),
    description: (detail && detail.description) || null,
    rowCount,
    columnCount: Number.isFinite(Number(detail && detail.columnCount))
      ? Number(detail.columnCount)
      : columns.length || null,
    sizeBytes: firstFiniteNumber(
      detail && detail.sizeInBytes,
      detail && detail.dataSourceSize,
      detail && detail.sizeBytes
    ),
    qualityScore: null,
    lastRefreshedAt: (detail && (detail.lastTouched ?? detail.lastUpdated ?? detail.updatedAt)) || null,
    owner:
      detail && detail.owner && typeof detail.owner === 'object'
        ? detail.owner.name || detail.owner.displayName || null
        : (detail && detail.ownerName) || null,
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
    const value = Number(candidate);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

export {
  normaliseHost,
  verify,
  listDatasets,
  getTableProfile,
};
