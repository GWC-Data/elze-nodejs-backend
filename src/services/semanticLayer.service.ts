import {
  AGGREGATIONS,
  AGG_REQUIRES_NUMERIC,
  AGG_REQUIRES_ORDERABLE,
  OPERATORS,
  SORT_DIRECTIONS,
  MONTH_NAMES,
  DEFAULT_DATE_GRAIN,
  GRAIN_INFERENCE_ORDER,
} from '../constants/query';
import { quoteIdentifier, escapeLiteral } from '../tools/sql';

type ColumnMeta = Record<string, any> | null | undefined;
type PlanNode = Record<string, any>;

interface DateGrain {
  key: string;
  format: string;
  pattern: RegExp;
  sortKey: (m: RegExpExecArray) => number;
  display: (m: RegExpExecArray) => string;
}

function pad2(value: unknown): string {
  return String(value).padStart(2, '0');
}

function monthName(month: unknown): string {
  const idx = Number(month) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx > 11) {
    throw new RangeError(`Month out of range: ${month}`);
  }
  return MONTH_NAMES[idx];
}

const DATE_GRAINS: Record<string, DateGrain> = {
  HOUR: {
    key: 'HOUR',
    format: 'YYYY-MM-DD HH24":00"',
    pattern: /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/,
    sortKey: (m) => Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])),
    display: (m) => `${monthName(m[2])} ${Number(m[3])}, ${m[1]} ${pad2(Number(m[4]))}:${m[5]}`,
  },
  DAY: {
    key: 'DAY',
    format: 'YYYY-MM-DD',
    pattern: /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
    sortKey: (m) => Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
    display: (m) => `${monthName(m[2])} ${Number(m[3])}, ${m[1]}`,
  },
  WEEK: {
    key: 'WEEK',
    format: 'IYYY"-W"IW',
    pattern: /^(\d{4})-W(\d{1,2})$/,
    sortKey: (m) => Number(m[1]) * 100 + Number(m[2]),
    display: (m) => `W${pad2(Number(m[2]))} ${m[1]}`,
  },
  MONTH: {
    key: 'MONTH',
    format: 'YYYY-MM',
    pattern: /^(\d{4})-(\d{1,2})$/,
    sortKey: (m) => Number(m[1]) * 100 + Number(m[2]),
    display: (m) => `${monthName(m[2])} ${m[1]}`,
  },
  YEAR: {
    key: 'YEAR',
    format: 'YYYY',
    pattern: /^(\d{4})$/,
    sortKey: (m) => Number(m[1]),
    display: (m) => String(m[1]),
  },
};

function resolvedName(node: PlanNode | null | undefined): string {
  const name = node && node.columnMeta && node.columnMeta.name;
  if (!name) {
    throw new Error(
      `Plan node for column "${node && node.column}" has no resolved metadata; ` +
      'it cannot be rendered safely.'
    );
  }
  return name;
}

function resolveAggregation(fn: unknown): string {
  const upper = String(fn || 'SUM').toUpperCase();
  const sqlFn = AGGREGATIONS[upper];
  if (!sqlFn) {
    throw new Error(`Unknown aggregation "${fn}". Supported: ${Object.keys(AGGREGATIONS).join(', ')}`);
  }
  return sqlFn;
}

function resolveOperator(op: unknown): string {
  const upper = String(op || 'IN').toUpperCase();
  const sql = OPERATORS[upper];
  if (!sql) {
    throw new Error(`Unsupported filter operator "${op}". Supported: ${Object.keys(OPERATORS).join(', ')}`);
  }
  return sql;
}

function resolveSortDirection(direction: unknown): string {
  const raw = direction == null ? '' : String(direction).trim();
  if (!raw) return SORT_DIRECTIONS.ASC;
  const sql = SORT_DIRECTIONS[raw.toUpperCase()];
  if (!sql) {
    throw new Error(`Unsupported sort direction "${direction}". Supported: ${Object.keys(SORT_DIRECTIONS).join(', ')}`);
  }
  return sql;
}

function resolveDateGrain(grain: unknown): DateGrain {
  const raw = grain == null ? '' : String(grain).trim();
  if (!raw) return DATE_GRAINS[DEFAULT_DATE_GRAIN];
  const resolved = DATE_GRAINS[raw.toUpperCase()];
  if (!resolved) {
    throw new Error(`Unsupported date grain "${grain}". Supported: ${Object.keys(DATE_GRAINS).join(', ')}`);
  }
  return resolved;
}

function inferGrainFromPeriod(period: string): DateGrain | null {
  for (const key of GRAIN_INFERENCE_ORDER) {
    if (DATE_GRAINS[key].pattern.test(period)) return DATE_GRAINS[key];
  }
  return null;
}

function grainForPeriod(period: string, grain: unknown): DateGrain | null {
  if (grain) {
    const raw = String(grain).trim().toUpperCase();
    if (DATE_GRAINS[raw]) return DATE_GRAINS[raw];
  }
  return inferGrainFromPeriod(period);
}

function isDateColumn(colMeta: ColumnMeta): boolean {
  return !!(colMeta && (colMeta.isDate || colMeta.isTemporal));
}

function isNumericColumn(colMeta: ColumnMeta): boolean {
  return !!(colMeta && colMeta.isNumeric);
}

function isStringColumn(colMeta: ColumnMeta): boolean {
  return !!(colMeta && colMeta.isString);
}

function describeColumnType(colMeta: ColumnMeta): string {
  if (!colMeta) return 'of unknown type';
  if (isNumericColumn(colMeta)) return `numeric (${colMeta.type})`;
  if (isDateColumn(colMeta)) return `a date/time column (${colMeta.type})`;
  if (isStringColumn(colMeta)) return `text (${colMeta.type})`;
  return `of unsupported type (${colMeta.type || 'unknown'})`;
}

function validateAggregation(aggFn: unknown, column: string, colMeta: ColumnMeta, tableName?: string | null): string {
  const sqlAgg = resolveAggregation(aggFn);
  const where = tableName ? ` in table "${tableName}"` : '';

  if (AGG_REQUIRES_NUMERIC.has(sqlAgg) && !isNumericColumn(colMeta)) {
    throw new Error(
      `Aggregation "${sqlAgg}" requires a numeric column, but "${column}"${where} is ${describeColumnType(colMeta)}. ` +
      'Use COUNT or COUNT_DISTINCT for non-numeric columns, or point the measure at a numeric column.'
    );
  }

  if (
    AGG_REQUIRES_ORDERABLE.has(sqlAgg) &&
    !isNumericColumn(colMeta) &&
    !isDateColumn(colMeta) &&
    !isStringColumn(colMeta)
  ) {
    throw new Error(
      `Aggregation "${sqlAgg}" requires a numeric, date or text column, but "${column}"${where} is ${describeColumnType(colMeta)}.`
    );
  }

  return sqlAgg;
}

function buildDateGroupExpression(column: string, grain: unknown, opts?: Record<string, any> | null): string {
  const col = quoteIdentifier(column);
  const fmt = resolveDateGrain(grain).format;
  const options = opts || {};

  if (options.isString) {
    const parseFormat = options.parseFormat;
    if (!parseFormat) {
      throw new Error(
        `Date column "${column}" has a string type. Provide its parse format in dataSource.dateParse ` +
        `(e.g. {"${column}": "DD-Mon-YY"}) or use a native DATE/TIMESTAMP column.`
      );
    }
    if (parseFormat.includes('%')) {
      throw new Error(
        `dateParse for "${column}" uses the pattern "${parseFormat}", which is not a to_date ` +
        'template. Use one instead, e.g. "DD-Mon-YY" for 15-Aug-23, "YYYY-MM-DD" for 2023-08-15.'
      );
    }
    return `to_char(to_date(${col}, '${escapeLiteral(parseFormat)}'), '${fmt}')`;
  }

  return `to_char(${col}, '${fmt}')`;
}

function buildAggExpression(aggFn: unknown, column: string, alias?: string | null): string {
  const col = quoteIdentifier(column);
  const sqlAgg = resolveAggregation(aggFn);
  let expr: string;
  if (sqlAgg === 'COUNT_DISTINCT') {
    expr = `COUNT(DISTINCT ${col})`;
  } else {
    expr = `${sqlAgg}(${col})`;
  }
  return alias ? `${expr} AS ${quoteIdentifier(alias)}` : expr;
}

function buildNonEmptyCondition(column: string, colMeta: ColumnMeta): string {
  const col = quoteIdentifier(column);
  const parts = [`${col} IS NOT NULL`];
  if (isStringColumn(colMeta)) parts.push(`${col} <> ''`);
  return parts.join(' AND ');
}

function buildWhereSql(filters: PlanNode[] | null | undefined): { where: string; params: string[] } {
  const conditions: string[] = [];
  const params: string[] = [];
  for (const f of filters || []) {
    const col = quoteIdentifier(resolvedName(f));
    const op = resolveOperator(f.operator || 'IN');

    const cmp = isStringColumn(f.columnMeta) ? col : `${col}::text`;

    if (op === 'IN') {
      const values = Array.isArray(f.values) ? f.values : [];
      if (!values.length) continue;
      const placeholders = values.map(() => '?').join(', ');
      conditions.push(`${cmp} IN (${placeholders})`);
      params.push(...values.map(String));
    } else if (op === 'BETWEEN') {
      const values = Array.isArray(f.values) ? f.values : [];
      if (values.length < 2) continue;
      conditions.push(`${cmp} BETWEEN ? AND ?`);
      params.push(String(values[0]), String(values[1]));
    } else {
      const values = Array.isArray(f.values) ? f.values : [];
      if (!values.length) continue;
      conditions.push(`${cmp} ${op} ?`);
      params.push(String(values[0]));
    }
  }
  return {
    where: conditions.length ? ' WHERE ' + conditions.join(' AND ') : '',
    params,
  };
}

function parsePeriodKey(period: unknown, grain?: unknown): number {
  const raw = period == null ? '' : String(period);
  if (!raw) return 0;

  const resolved = grainForPeriod(raw, grain);
  if (resolved) {
    const match = resolved.pattern.exec(raw);
    if (match) {
      try {
        const key = resolved.sortKey(match);
        if (Number.isFinite(key)) return key;
      } catch (_) {
      }
    }
  }

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatPeriodDisplay(period: unknown, grain?: unknown): string {
  if (period == null) return '';
  const raw = String(period);
  if (!raw) return '';

  const resolved = grainForPeriod(raw, grain);
  if (!resolved) return raw;

  const match = resolved.pattern.exec(raw);
  if (!match) return raw;

  try {
    const label = resolved.display(match);
    if (label == null) return raw;
    const text = String(label);
    return text && !text.includes('undefined') ? text : raw;
  } catch (_) {
    return raw;
  }
}

export {
  resolvedName,
  resolveSortDirection,
  resolveDateGrain,
  validateAggregation,
  buildDateGroupExpression,
  buildAggExpression,
  buildNonEmptyCondition,
  buildWhereSql,
  parsePeriodKey,
  formatPeriodDisplay,
};
