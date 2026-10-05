import { Pool, types } from 'pg';
import type { PoolClient, PoolConfig, QueryResult, QueryResultRow } from 'pg';

const PG_INT8 = 20;
const PG_NUMERIC = 1700;

types.setTypeParser(PG_INT8, (value: string | null) => (value === null ? null : Number(value)));
types.setTypeParser(PG_NUMERIC, (value: string | null) => (value === null ? null : Number(value)));

type Params = readonly unknown[];

// Rows default to `any`: callers read columns by name from hand-written SQL, and a
// row type is added where a caller benefits from one.
interface Queryable {
  query<R extends QueryResultRow = any>(sql: string, params?: Params): Promise<QueryResult<R>>;
  raw<R extends QueryResultRow = any>(sql: string, params?: Params): Promise<QueryResult<R>>;
}

interface Db extends Queryable {
  transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T>;
  end(): Promise<void>;
  pool: Pool;
}

function toPositionalParams(sql: string): string {
  let out = '';
  let index = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      out += ch;
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      out += ch;
      if (ch === '*' && next === '/') {
        out += next;
        i++;
        inBlockComment = false;
      }
      continue;
    }
    if (!inSingle && !inDouble && ch === '-' && next === '-') {
      inLineComment = true;
      out += ch;
      continue;
    }
    if (!inSingle && !inDouble && ch === '/' && next === '*') {
      inBlockComment = true;
      out += ch;
      continue;
    }

    if (ch === "'" && !inDouble) {
      if (inSingle && next === "'") {
        out += ch + next;
        i++;
        continue;
      }
      inSingle = !inSingle;
      out += ch;
      continue;
    }
    if (ch === '"' && !inSingle) {
      if (inDouble && next === '"') {
        out += ch + next;
        i++;
        continue;
      }
      inDouble = !inDouble;
      out += ch;
      continue;
    }

    if (ch === '?' && !inSingle && !inDouble) {
      out += `$${++index}`;
      continue;
    }
    out += ch;
  }

  return out;
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
        try { await client.query('ROLLBACK'); } catch { }
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
