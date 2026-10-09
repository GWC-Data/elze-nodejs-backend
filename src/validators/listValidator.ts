import { fail } from '../tools/AppError';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MAX_SEARCH_LENGTH } from '../constants/pagination';

interface ListDefaults {
  pageSize?: number;
  sort?: string;
  dir?: string;
}

interface ListQuery {
  page: number;
  pageSize: number;
  offset: number;
  search: string;
  sort: string | undefined;
  dir: 'asc' | 'desc';
}

function intParam(value: unknown, fallback: number, { min, max, name }: { min: number; max?: number; name: string }): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || (max !== undefined && n > max)) {
    throw fail('VALIDATION_ERROR', `${name} must be a whole number${max ? ` from ${min} to ${max}` : ` of at least ${min}`}.`);
  }
  return n;
}

function parseListQuery(query: Record<string, any>, sortable: Record<string, unknown>, defaults: ListDefaults = {}): ListQuery {
  const page = intParam(query.page, 1, { min: 1, name: 'page' });
  const pageSize = intParam(query.pageSize, defaults.pageSize || DEFAULT_PAGE_SIZE, {
    min: 1,
    max: MAX_PAGE_SIZE,
    name: 'pageSize',
  });

  const search = typeof query.search === 'string' ? query.search.trim().slice(0, MAX_SEARCH_LENGTH) : '';

  const sort = query.sort === undefined || query.sort === '' ? defaults.sort : String(query.sort);
  if (sort !== undefined && !Object.prototype.hasOwnProperty.call(sortable, sort)) {
    throw fail('VALIDATION_ERROR', `sort must be one of: ${Object.keys(sortable).join(', ')}.`);
  }
  const dirRaw = query.dir === undefined || query.dir === '' ? defaults.dir || 'asc' : String(query.dir);
  if (dirRaw !== 'asc' && dirRaw !== 'desc') {
    throw fail('VALIDATION_ERROR', 'dir must be asc or desc.');
  }

  return { page, pageSize, offset: (page - 1) * pageSize, search, sort, dir: dirRaw };
}

export { parseListQuery };
export type { ListQuery, ListDefaults };
