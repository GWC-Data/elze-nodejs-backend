import fs from 'fs';
import path from 'path';
import config from '../config';
import { T } from '../models/rbac.model';
import { quoteIdentifier } from '../tools/sql';
import type { Queryable } from '../config/pgPool';

const { db, withTransaction } = config.database;
const { RBAC_CONFIG_DIR } = config.env;

// A dimension entry from scope-dimensions.json.
type ScopeDimension = Record<string, any>;

const CONFIG_FILE = path.join(RBAC_CONFIG_DIR, 'scope-dimensions.json');

const MAX_DISTINCT_VALUES = 500;

function readDimensionsFile(): any {
  let raw;
  try {
    raw = fs.readFileSync(CONFIG_FILE, 'utf8');
  } catch {
    return null;
  }
  return JSON.parse(raw.replace(/^﻿/, ''));
}

function configFileName(): string {
  return path.basename(CONFIG_FILE);
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
    `SELECT dimension, value FROM ${T.userDataScope} WHERE user_id = ? ORDER BY dimension, value`,
    [userId]
  );
  return rows;
}

async function replaceUserScopes(userId: number, scopes: Record<string, readonly string[]>): Promise<void> {
  await withTransaction(async (conn: Queryable) => {
    for (const [dimension, values] of Object.entries(scopes)) {
      await conn.query(
        `DELETE FROM ${T.userDataScope} WHERE user_id = ? AND dimension = ?`,
        [userId, dimension]
      );
      if (values.length) {
        const placeholders = values.map(() => '(?, ?, ?)').join(', ');
        await conn.query(
          `INSERT INTO ${T.userDataScope} (user_id, dimension, value) VALUES ${placeholders}`,
          values.flatMap((v) => [userId, dimension, v])
        );
      }
    }
  });
}

export { readDimensionsFile, configFileName, distinctValues, userScopeRows, replaceUserScopes };
export type { ScopeDimension };
