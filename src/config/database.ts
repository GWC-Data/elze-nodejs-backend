import './env';
import { createPool } from './pgPool';
import type { Queryable } from './pgPool';
import { required, optional, integer, boolean } from './configError';

function sslConfig(): false | { rejectUnauthorized: boolean } {
  if (!boolean('DB_SSL', false)) return false;
  return { rejectUnauthorized: boolean('DB_SSL_REJECT_UNAUTHORIZED', true) };
}

const DB_NAME = required('DB_NAME', 'the database holding both the reporting tables and app metadata');

const pool = createPool({
  host: required('DB_HOST', 'the PostgreSQL server this application uses'),
  port: integer('DB_PORT', 5432, { min: 1, max: 65535 }),
  user: required('DB_USER', 'the account the application connects as'),
  password: optional('DB_PASSWORD', ''),
  database: DB_NAME,
  max: integer('DB_POOL_SIZE', 10, { min: 1, max: 100 }),
  ssl: sslConfig(),
  connectionTimeoutMillis: integer('DB_CONNECT_TIMEOUT_MS', 15000, { min: 1000 }),
  idleTimeoutMillis: 30000,
});

function withTransaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T> {
  return pool.transaction(work);
}

export { pool as db, withTransaction, DB_NAME };
