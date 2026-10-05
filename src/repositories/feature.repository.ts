import config from '../config';
import { T } from '../models/rbac.model';
import type { Queryable } from '../config/pgPool';

const { db, withTransaction } = config.database;

async function listForCompany(companyId: number, conn?: Queryable): Promise<string[]> {
  const client = conn || db;
  const { rows } = await client.query(
    `SELECT feature_id FROM ${T.companyFeatures} WHERE company_id = ? ORDER BY feature_id`,
    [companyId]
  );
  return rows.map((r) => r.feature_id);
}

// Replace the whole set: toggles are sent as "these are on", never as a diff, so two admins
// editing at once converge on the last save instead of merging into something neither chose.
async function replace(companyId: number, featureIds: readonly string[], actorId: number | null, conn?: Queryable) {
  const work = async (client: Queryable) => {
    await client.query(`DELETE FROM ${T.companyFeatures} WHERE company_id = ?`, [companyId]);
    if (featureIds.length) {
      await client.query(
        `INSERT INTO ${T.companyFeatures} (company_id, feature_id, enabled_by)
         SELECT ?, f, ? FROM unnest(?::text[]) AS f`,
        [companyId, actorId, featureIds]
      );
    }
    await client.query(`UPDATE ${T.companies} SET features_seeded = TRUE WHERE id = ?`, [companyId]);
  };
  if (conn) return work(conn);
  return withTransaction(work);
}

// Companies that predate feature toggles get every toggleable feature, once.
async function seedUnseeded(featureIds: readonly string[]): Promise<number> {
  return withTransaction(async (conn: Queryable) => {
    const { rows } = await conn.query(
      `SELECT id FROM ${T.companies} WHERE NOT features_seeded FOR UPDATE`
    );
    if (!rows.length) return 0;
    const ids = rows.map((r) => r.id);
    await conn.query(
      `INSERT INTO ${T.companyFeatures} (company_id, feature_id)
       SELECT c, f FROM unnest(?::int[]) AS c, unnest(?::text[]) AS f
       ON CONFLICT DO NOTHING`,
      [ids, featureIds]
    );
    await conn.query(`UPDATE ${T.companies} SET features_seeded = TRUE WHERE id = ANY(?::int[])`, [ids]);
    return ids.length;
  });
}

export { listForCompany, replace, seedUnseeded };
