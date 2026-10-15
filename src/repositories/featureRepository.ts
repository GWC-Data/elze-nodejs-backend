import config from '../config';
import { T } from '../models/rbacModel';
import type { Queryable } from '../config/pgPool';

const { db, withTransaction } = config.database;

async function listForCompany(companyId: number, conn?: Queryable): Promise<string[]> {
  const client = conn || db;
  const { rows } = await client.query(
    `SELECT feature_ids FROM ${T.companyFeatures} WHERE company_id = ?`,
    [companyId]
  );
  return rows[0] ? rows[0].feature_ids : [];
}

async function replace(companyId: number, featureIds: readonly string[], actorId: number | null, conn?: Queryable) {
  const work = async (client: Queryable) => {
    await client.query(
      `INSERT INTO ${T.companyFeatures} (company_id, feature_ids, updated_by)
       VALUES (?, ?::uuid[], ?)
       ON CONFLICT (company_id) DO UPDATE
         SET feature_ids = EXCLUDED.feature_ids, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [companyId, featureIds, actorId]
    );
  };
  if (conn) return work(conn);
  return withTransaction(work);
}

export { listForCompany, replace };
