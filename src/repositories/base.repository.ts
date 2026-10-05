import { fail } from '../tools/AppError';
import { INVALID_TEXT_REPRESENTATION } from '../constants/pgErrors';
import type { QueryResult } from 'pg';
import type { Queryable, Params } from '../config/pgPool';
import type { Actor } from '../types/actor';

// The paging window a list endpoint passes down (see validators/list.validator).
type ListWindow = { pageSize: number; offset: number } & Record<string, any>;

interface CompanyScope {
  clause: string;
  params: (number | null)[];
}

async function pagedRows<T>(
  client: Queryable,
  sql: string,
  params: Params,
  countSql: string,
  countParams: Params,
  shape: (row: any) => T
): Promise<{ items: T[]; total: number }> {
  const { rows } = await client.query(sql, params);
  let total;
  if (rows.length) {
    total = Number(rows[0].__total);
  } else {
    const counted = await client.query(countSql, countParams);
    total = Number(counted.rows[0].n);
  }
  return { items: rows.map(shape), total };
}

async function queryOrNotFound(client: Queryable, sql: string, params: Params, message: string): Promise<QueryResult<any>> {
  try {
    return await client.query(sql, params);
  } catch (err: any) {
    if (err.code === INVALID_TEXT_REPRESENTATION) throw fail('RESOURCE_NOT_FOUND', message);
    throw err;
  }
}

function companyScope(actor: Pick<Actor, 'isPlatform' | 'companyId'>, column: string): CompanyScope {
  if (actor.isPlatform) return { clause: '1 = 1', params: [] };
  return { clause: `${column} = ?`, params: [actor.companyId] };
}

function numericRow(row: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}

export { pagedRows, queryOrNotFound, companyScope, numericRow };
export type { ListWindow, CompanyScope };
