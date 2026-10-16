import config from '../config';
import { Prisma } from '../generated/prisma/client';
import { rawRows } from './baseRepository';
import { quoteIdentifier } from '../tools/sql';

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
  return rawRows(
    prisma,
    Prisma.sql`SELECT d.key AS dimension, v.value
       FROM access_control.user_data_scopes s
       CROSS JOIN LATERAL jsonb_each(s.scopes) AS d
       CROSS JOIN LATERAL jsonb_array_elements_text(d.value) AS v(value)
      WHERE s.user_id = ${userId}
      ORDER BY d.key, v.value`
  );
}

async function replaceUserScopes(
  userId: number,
  scopes: Record<string, readonly string[]>,
  actorId: number | null = null
): Promise<void> {
  await withTransaction(async (tx) => {
    const [current] = await rawRows<{ scopes: Record<string, string[]> }>(
      tx,
      Prisma.sql`SELECT scopes FROM access_control.user_data_scopes WHERE user_id = ${userId} FOR UPDATE`
    );
    const next: Record<string, string[]> = { ...(current?.scopes || {}) };
    for (const [dimension, values] of Object.entries(scopes)) {
      if (values.length) next[dimension] = [...values].sort();
      else delete next[dimension];
    }
    if (!Object.keys(next).length) {
      await tx.userDataScope.deleteMany({ where: { userId } });
      return;
    }
    await tx.userDataScope.upsert({
      where: { userId },
      create: { userId, scopes: next, updatedBy: actorId },
      update: { scopes: next, updatedBy: actorId, updatedAt: new Date() },
    });
  });
}

export { listDimensions, distinctValues, userScopeRows, replaceUserScopes };
export type { ScopeDimension };
