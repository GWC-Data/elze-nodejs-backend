import config from '../config';
import { T } from '../models/rbacModel';
import { quoteIdentifier } from '../tools/sql';
import type { Queryable } from '../config/pgPool';

const { db, prisma, withTransaction } = config.database;

interface ScopeDimension {
  dimension: string;
  label: string | null;
  database: string | null;
  table: string;
  column: string;
}

const MAX_DISTINCT_VALUES = 500;

async function listDimensions(): Promise<ScopeDimension[]> {
  const rows = await prisma.scopeDimension.findMany({ orderBy: [{ sortOrder: 'asc' }, { dimension: 'asc' }] });
  return rows.map((r) => ({
    dimension: r.dimension,
    label: r.label,
    database: r.sourceSchema,
    table: r.sourceTable,
    column: r.sourceColumn,
  }));
}

async function distinctValues(dimension: ScopeDimension): Promise<string[]> {
  const target = dimension.database
    ? `${quoteIdentifier(dimension.database)}.${quoteIdentifier(dimension.table)}`
    : quoteIdentifier(dimension.table);
  const column = quoteIdentifier(dimension.column);
  const { rows } = await db.query(
    `SELECT DISTINCT ${column} AS value FROM ${target}
      WHERE ${column} IS NOT NULL AND ${column}::text <> ''
      ORDER BY ${column} LIMIT ${MAX_DISTINCT_VALUES}`
  );
  return rows.map((r) => String(r.value));
}

async function userScopeRows(userId: number) {
  const { rows } = await db.query(
    `SELECT d.key AS dimension, v.value
       FROM ${T.userDataScopes} s
       CROSS JOIN LATERAL jsonb_each(s.scopes) AS d
       CROSS JOIN LATERAL jsonb_array_elements_text(d.value) AS v(value)
      WHERE s.user_id = ?
      ORDER BY d.key, v.value`,
    [userId]
  );
  return rows;
}

async function replaceUserScopes(userId: number, scopes: Record<string, readonly string[]>, actorId: number | null = null): Promise<void> {
  await withTransaction(async (conn: Queryable) => {
    const { rows } = await conn.query(
      `SELECT scopes FROM ${T.userDataScopes} WHERE user_id = ? FOR UPDATE`,
      [userId]
    );
    const next: Record<string, string[]> = { ...((rows[0] && rows[0].scopes) || {}) };
    for (const [dimension, values] of Object.entries(scopes)) {
      if (values.length) next[dimension] = [...values].sort();
      else delete next[dimension];
    }
    if (!Object.keys(next).length) {
      await conn.query(`DELETE FROM ${T.userDataScopes} WHERE user_id = ?`, [userId]);
      return;
    }
    await conn.query(
      `INSERT INTO ${T.userDataScopes} (user_id, scopes, updated_by)
       VALUES (?, ?::jsonb, ?)
       ON CONFLICT (user_id) DO UPDATE
         SET scopes = EXCLUDED.scopes, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [userId, JSON.stringify(next), actorId]
    );
  });
}

export { listDimensions, distinctValues, userScopeRows, replaceUserScopes };
export type { ScopeDimension };
