import './env';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client';
import { createPool } from './pgPool';
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

const prisma = new PrismaClient({
  adapter: new PrismaPg(pool.pool),
  transactionOptions: {
    maxWait: integer('DB_TRANSACTION_WAIT_MS', 10000, { min: 1000 }),
    timeout: integer('DB_TRANSACTION_TIMEOUT_MS', 30000, { min: 1000 }),
  },
});

type Tx = Prisma.TransactionClient;

function withTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(work);
}

export { pool as db, prisma, withTransaction, DB_NAME };
export type { Tx };
