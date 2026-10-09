import config from '../config';
import { quoteQualified } from '../tools/sql';
import type { Params } from '../config/pgPool';

const { db } = config.database;

function executeQuery(sql: string, params?: Params | null): Promise<{ rows: any[]; elapsed: number }> {
  const start = Date.now();
  return db.query(sql, params || [])
    .then((result) => {
      const elapsed = Date.now() - start;
      return { rows: result.rows, elapsed };
    })
    .catch((err: any) => {
      const elapsed = Date.now() - start;
      console.error(`[QueryExecutor] SQL failed (${elapsed}ms):`, err.message);
      console.error('[QueryExecutor] SQL:', sql);
      console.error('[QueryExecutor] Params:', params);
      throw err;
    });
}

async function tableColumns(schema: string, table: string) {
  const { rows } = await db.query(
    `SELECT a.attname                               AS name,
            format_type(a.atttypid, a.atttypmod)    AS column_type,
            t.typname                               AS typname,
            NOT a.attnotnull                        AS nullable
       FROM pg_attribute a
       JOIN pg_class     c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_type      t ON t.oid = a.atttypid
      WHERE n.nspname = ?
        AND c.relname = ?
        AND c.relkind IN ('r','v','m','f','p')
        AND a.attnum > 0
        AND NOT a.attisdropped
      ORDER BY a.attnum`,
    [schema, table]
  );
  return rows;
}

async function countRows(schema: string, table: string): Promise<number> {
  const { rows } = await db.query(`SELECT COUNT(*)::bigint AS n FROM ${quoteQualified(schema, table)}`);
  return Number(rows[0].n);
}

export { executeQuery, tableColumns, countRows };
