import { Pool, types } from 'pg';
import type { PoolClient, PoolConfig, QueryResult, QueryResultRow } from 'pg';
import { splitPlaceholders } from './sql';

const PG_INT8 = 20;
const PG_NUMERIC = 1700;

types.setTypeParser(PG_INT8, (value: string | null) => (value === null ? null : Number(value)));
types.setTypeParser(PG_NUMERIC, (value: string | null) => (value === null ? null : Number(value)));

type Params = readonly unknown[];

interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(sql: string, params?: Params): Promise<QueryResult<R>>;
  raw<R extends QueryResultRow = QueryResultRow>(sql: string, params?: Params): Promise<QueryResult<R>>;
}

interface Db extends Queryable {
  transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T>;
  end(): Promise<void>;
  pool: Pool;
}

function toPositionalParams(sql: string): string {
  return splitPlaceholders(sql)
    .map((piece, index) => (index ? `$${index}${piece}` : piece))
    .join('');
}

function wrap(client: Pool | PoolClient): Queryable {
  return {
    query(sql, params) {
      return client.query(toPositionalParams(sql), (params || []) as unknown[]);
    },
    raw(sql, params) {
      return client.query(sql, (params || []) as unknown[]);
    },
  };
}

function createPool(config: PoolConfig): Db {
  const pool = new Pool(config);

  pool.on('error', (err) => {
    console.error(`[db] idle client error on ${config.database || 'postgres'}:`, err.message);
  });

  const wrapped = wrap(pool);

  return {
    query: wrapped.query,
    raw: wrapped.raw,

    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work(wrap(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {}
        throw err;
      } finally {
        client.release();
      }
    },

    end: () => pool.end(),
    pool,
  };
}

export { createPool };
export type { Db, Queryable, Params };
