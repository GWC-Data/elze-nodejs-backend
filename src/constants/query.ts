const AGGREGATIONS: Record<string, string> = {
  SUM: 'SUM',
  AVERAGE: 'AVG',
  AVG: 'AVG',
  MEAN: 'AVG',
  COUNT: 'COUNT',
  COUNTDISTINCT: 'COUNT_DISTINCT',
  COUNT_DISTINCT: 'COUNT_DISTINCT',
  DISTINCT_COUNT: 'COUNT_DISTINCT',
  MIN: 'MIN',
  MAX: 'MAX',
};

const AGG_REQUIRES_NUMERIC = new Set(['SUM', 'AVG']);
const AGG_REQUIRES_ORDERABLE = new Set(['MIN', 'MAX']);

const OPERATORS: Record<string, string> = {
  IN: 'IN',
  EQ: '=',
  EQUALS: '=',
  '=': '=',
  NE: '!=',
  NEQ: '!=',
  '!=': '!=',
  GT: '>',
  '>': '>',
  GTE: '>=',
  '>=': '>=',
  LT: '<',
  '<': '<',
  LTE: '<=',
  '<=': '<=',
  LIKE: 'LIKE',
  BETWEEN: 'BETWEEN',
};

const SORT_DIRECTIONS: Record<string, string> = {
  ASC: 'ASC',
  ASCENDING: 'ASC',
  DESC: 'DESC',
  DESCENDING: 'DESC',
};

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const DEFAULT_DATE_GRAIN = 'MONTH';

const DATE_TYPES = new Set(['date', 'timestamp', 'timestamptz', 'time', 'timetz']);
const NUMERIC_TYPES = new Set(['int2', 'int4', 'int8', 'numeric', 'float4', 'float8', 'money']);
const STRING_TYPES = new Set(['text', 'varchar', 'bpchar', 'char', 'name', 'citext', 'uuid']);

const IDENTIFIER_RE = /^[A-Za-z0-9_$]+$/;

const GRAIN_INFERENCE_ORDER = ['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR'];

const PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

const ABBREVIATE_ABOVE = 10000;

export {
  AGGREGATIONS,
  AGG_REQUIRES_NUMERIC,
  AGG_REQUIRES_ORDERABLE,
  OPERATORS,
  SORT_DIRECTIONS,
  MONTH_NAMES,
  DEFAULT_DATE_GRAIN,
  GRAIN_INFERENCE_ORDER,
  DATE_TYPES,
  NUMERIC_TYPES,
  STRING_TYPES,
  IDENTIFIER_RE,
  PALETTE,
  ABBREVIATE_ABOVE,
};
