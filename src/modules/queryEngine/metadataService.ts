import config from '../../config';
import * as queryRepository from './queryRepository';
import { fail } from '../../shared/errors/AppError';
import TtlCache from '../../shared/cache/ttlCache';
import { DATE_TYPES, NUMERIC_TYPES, STRING_TYPES, IDENTIFIER_RE } from './queryConstants';
import type { DashboardSpec } from '../dashboards/dashboardTypes';
import type { ColumnMeta, ColumnTypeInfo, SourceMetadata, SourceRef, TableMetadata } from './queryTypes';

const { DB_SCHEMA: DEFAULT_SCHEMA } = config.engine;
const { DB_NAME } = config.database;

const cache = new TtlCache();
const inflight = new Map<string, Promise<TableMetadata>>();

function isTableMetadata(value: unknown): value is TableMetadata {
  return typeof value === 'object' && value !== null;
}

function classifyType(typname: string | null | undefined): ColumnTypeInfo {
  const t = String(typname || '').toLowerCase();
  return {
    type: t,
    isDate: DATE_TYPES.has(t),
    isNumeric: NUMERIC_TYPES.has(t),
    isString: STRING_TYPES.has(t),
    isTemporal: DATE_TYPES.has(t),
  };
}

function tableKey(schema: string, table: string): string {
  return `${schema}.${table}`;
}

function getSource(spec: DashboardSpec): SourceRef {
  if (!spec || typeof spec !== 'object') {
    throw new Error('Dashboard spec must be a non-null object');
  }

  const dataSource = spec.dataSource || spec.source || {};
  let table = dataSource.table || dataSource.name || null;

  if (!table && typeof spec.dataset === 'string') {
    table = spec.dataset;
  } else if (!table && spec.dataset && typeof spec.dataset === 'object') {
    table = spec.dataset.table || null;
  }

  if (!table || typeof table !== 'string' || !table.trim()) {
    throw new Error('Dashboard metadata is missing a source table. Provide dataSource.table in the dashboard JSON.');
  }

  table = table.trim();
  if (!IDENTIFIER_RE.test(table)) {
    throw new Error(`Invalid table name "${table}". Allowed characters: letters, digits, underscore, $`);
  }

  const schema = String(
    dataSource.schema ||
      (spec.dataset && typeof spec.dataset === 'object' ? spec.dataset.schema : null) ||
      DEFAULT_SCHEMA
  ).trim();

  if (!IDENTIFIER_RE.test(schema)) {
    throw new Error(`Invalid schema name "${schema}". Allowed characters: letters, digits, underscore, $`);
  }

  const declared =
    dataSource.database || (spec.dataset && typeof spec.dataset === 'object' ? spec.dataset.database : null) || null;

  if (declared && declared !== DB_NAME) {
    throw new Error(
      `Dashboard names database "${declared}" but this server is connected to ` +
        `"${DB_NAME}". PostgreSQL cannot query across databases - use ` +
        '"schema" in dataSource to select a schema within the connected database, ' +
        'or point DB_NAME at that database.'
    );
  }

  return { database: DB_NAME, schema, table };
}

async function fetchTableMetadata(source: SourceRef): Promise<TableMetadata> {
  const rows = await queryRepository.tableColumns(source.schema, source.table);

  if (!rows.length) {
    throw fail(
      'DASHBOARD_SOURCE_UNAVAILABLE',
      `This dashboard reads "${source.schema}.${source.table}", which does not exist in database ` +
        `"${source.database}". Load that table, or point the dashboard's dataSource at one that exists.`
    );
  }

  const columns: ColumnMeta[] = rows.map((c) => ({
    name: c.name,
    ...classifyType(c.typname),
    columnType: c.column_type,
    nullable: c.nullable,
  }));

  const columnMap = new Map<string, ColumnMeta>();
  const byLower = new Map<string, ColumnMeta>();
  for (const c of columns) {
    columnMap.set(c.name, c);
    byLower.set(String(c.name).toLowerCase(), c);
  }

  return {
    database: source.database,
    schema: source.schema,
    table: source.table,
    columns,
    columnMap,
    byLower,
  };
}

async function getTableMetadata(source: SourceRef): Promise<TableMetadata> {
  const key = tableKey(source.schema, source.table);
  const cached: unknown = cache.get(key);
  if (isTableMetadata(cached)) return cached;
  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = fetchTableMetadata(source)
    .then((meta) => {
      cache.set(key, meta);
      return meta;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

function resolveColumn(meta: TableMetadata, name: unknown): ColumnMeta {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('Invalid column name: empty or non-string');
  }
  const exact = meta.columnMap.get(name);
  if (exact) return exact;
  const folded = meta.byLower.get(String(name).toLowerCase());
  if (folded) return folded;
  throw new Error(`Unknown column "${name}" in table "${meta.table}"`);
}

function resolveSourceMetadata(spec: DashboardSpec): Promise<SourceMetadata> {
  const source = getSource(spec);
  return getTableMetadata(source).then((meta) => {
    const dataSource = spec.dataSource || spec.source || {};
    const dateParse = (dataSource && (dataSource.dateParse || dataSource.stringDates)) || spec?.dateParse || {};
    return {
      source,
      table: meta,
      columns: meta.columnMap,
      dateParse: typeof dateParse === 'object' && dateParse ? dateParse : {},
    };
  });
}

export { resolveColumn, resolveSourceMetadata };
