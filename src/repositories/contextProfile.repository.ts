import crypto from 'crypto';
import config from '../config';
import { CT } from '../models/context.model';

const { db } = config.database;

const COLUMNS = `id, connection_id, name, description, created_by, created_at, updated_at`;

async function find(connectionId: string) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM ${CT.profiles} WHERE connection_id = ?::uuid`,
    [connectionId]
  );
  return rows[0] || null;
}

async function upsert({ connectionId, companyId, name, description, createdBy }: {
  connectionId: string;
  companyId: number | null;
  name: string;
  description: string | null;
  createdBy: number | null;
}) {
  const { rows } = await db.query(
    `INSERT INTO ${CT.profiles} (id, connection_id, company_id, name, description, created_by)
     VALUES (?::uuid, ?::uuid, ?, ?, ?, ?)
     ON CONFLICT (connection_id) DO UPDATE
        SET name = EXCLUDED.name, description = EXCLUDED.description, updated_at = now()
     RETURNING ${COLUMNS}`,
    [crypto.randomUUID(), connectionId, companyId, name, description, createdBy]
  );
  return rows[0];
}

export { find, upsert };
