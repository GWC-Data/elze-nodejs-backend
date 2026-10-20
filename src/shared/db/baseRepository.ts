import { Prisma } from '../../generated/prisma/client';
import { fail } from '../errors/AppError';
import { sqlState } from './dbError';
import { splitPlaceholders } from './sql';
import { INVALID_TEXT_REPRESENTATION } from '../errors/pgErrors';
import type { Tx } from './database';
import type { ListParams } from './listQuery';
import type { Actor } from '../types/actor';

type ListWindow = ListParams;
type Row = Record<string, unknown>;

function plain(value: unknown): unknown {
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Prisma.Decimal) return value.toNumber();
  return value;
}

function plainRow<T>(row: Row): T {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, plain(value)])) as T;
}

function sqlOf(text: string, params: readonly unknown[] = []): Prisma.Sql {
  const pieces = splitPlaceholders(text);
  if (pieces.length - 1 !== params.length) {
    throw new Error(`SQL has ${pieces.length - 1} placeholder(s) but ${params.length} parameter(s) were given.`);
  }
  return new Prisma.Sql(pieces, params as Prisma.Sql[]);
}

async function rawRows<T>(tx: Tx, query: Prisma.Sql): Promise<T[]> {
  const rows = await tx.$queryRaw<Row[]>(query);
  return rows.map((row) => plainRow<T>(row));
}

async function pagedRows<R, T>(
  tx: Tx,
  query: Prisma.Sql,
  countQuery: Prisma.Sql,
  shape: (row: R) => T
): Promise<{ items: T[]; total: number }> {
  const rows = await rawRows<R & { __total: unknown }>(tx, query);
  let total: number;
  if (rows.length) {
    total = Number(rows[0].__total);
  } else {
    const counted = await rawRows<{ n: unknown }>(tx, countQuery);
    total = Number(counted[0].n);
  }
  return { items: rows.map(shape), total };
}

async function orNotFound<T>(work: Promise<T>, message: string): Promise<T> {
  try {
    return await work;
  } catch (err) {
    if (sqlState(err) === INVALID_TEXT_REPRESENTATION) throw fail('RESOURCE_NOT_FOUND', message);
    throw err;
  }
}

function companyScope(actor: Pick<Actor, 'isPlatform' | 'companyId'>, column: string): Prisma.Sql {
  if (actor.isPlatform) return Prisma.sql`TRUE`;
  return Prisma.sql`${Prisma.raw(column)} = ${actor.companyId}`;
}

function numericRow(row: Row): Record<string, number> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(plain(value))]));
}

export { plain, plainRow, sqlOf, rawRows, pagedRows, orNotFound, companyScope, numericRow };
export type { ListWindow };
