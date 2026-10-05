import config from '../config';
import { T } from '../models/rbac.model';
import type { Queryable } from '../config/pgPool';

const { db } = config.database;

const PURPOSE_ACTIVATION = 'activation';

async function insertRefresh(
  { id, familyId, userId, tokenHash, expiresAt }: {
    id: string;
    familyId: string;
    userId: number;
    tokenHash: string;
    expiresAt: Date;
  },
  conn?: Queryable
): Promise<void> {
  const client = conn || db;
  await client.query(
    `INSERT INTO ${T.refreshTokens} (id, family_id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, familyId, userId, tokenHash, expiresAt]
  );
}

async function markRotated(replacedId: string, byId: string, conn?: Queryable): Promise<void> {
  const client = conn || db;
  await client.query(
    `UPDATE ${T.refreshTokens}
        SET revoked_at = now(), revoked_reason = 'rotated', replaced_by = ?
      WHERE id = ? AND revoked_at IS NULL`,
    [byId, replacedId]
  );
}

async function revokeFamily(familyId: string, reason: string, conn?: Queryable): Promise<void> {
  const client = conn || db;
  await client.query(
    `UPDATE ${T.refreshTokens}
        SET revoked_at = now(), revoked_reason = ?
      WHERE family_id = ? AND revoked_at IS NULL`,
    [reason, familyId]
  );
}

async function revokeAllForUser(userId: number, reason: string, conn?: Queryable): Promise<number | null> {
  const client = conn || db;
  const result = await client.query(
    `UPDATE ${T.refreshTokens}
        SET revoked_at = now(), revoked_reason = ?
      WHERE user_id = ? AND revoked_at IS NULL`,
    [reason, userId]
  );
  return result.rowCount;
}

async function revokeAllForCompany(companyId: number, reason: string, conn?: Queryable): Promise<number | null> {
  const client = conn || db;
  const result = await client.query(
    `UPDATE ${T.refreshTokens}
        SET revoked_at = now(), revoked_reason = ?
      WHERE revoked_at IS NULL
        AND user_id IN (SELECT id FROM ${T.users} WHERE company_id = ?)`,
    [reason, companyId]
  );
  return result.rowCount;
}

async function findRefreshByHash(tokenHash: string) {
  const { rows } = await db.query(
    `SELECT id, family_id, user_id, expires_at, revoked_at, revoked_reason
       FROM ${T.refreshTokens} WHERE token_hash = ?`,
    [tokenHash]
  );
  return rows[0] || null;
}

async function pruneExpiredRefresh(): Promise<number | null> {
  const result = await db.query(
    `DELETE FROM ${T.refreshTokens}
      WHERE expires_at < (now() - interval '7 days')
         OR (revoked_at IS NOT NULL AND revoked_at < (now() - interval '7 days'))`
  );
  return result.rowCount;
}

async function listSessions(userId: number) {
  const { rows } = await db.query(
    `SELECT family_id AS "familyId", MAX(issued_at) AS "lastUsedAt"
       FROM ${T.refreshTokens}
      WHERE user_id = ? AND revoked_at IS NULL AND expires_at > now()
      GROUP BY family_id
      ORDER BY MAX(issued_at) DESC`,
    [userId]
  );
  return rows;
}

async function retireActivations(userId: number, conn?: Queryable): Promise<void> {
  const client = conn || db;
  await client.query(
    `UPDATE ${T.userTokens} SET consumed_at = now()
      WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL`,
    [userId, PURPOSE_ACTIVATION]
  );
}

async function insertActivation(
  { id, userId, tokenHash, expiresAt, createdBy }: {
    id: string;
    userId: number;
    tokenHash: string;
    expiresAt: Date;
    createdBy: number | null;
  },
  conn?: Queryable
): Promise<void> {
  const client = conn || db;
  await client.query(
    `INSERT INTO ${T.userTokens} (id, user_id, purpose, token_hash, expires_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, userId, PURPOSE_ACTIVATION, tokenHash, expiresAt, createdBy]
  );
}

async function findActivationByHash(tokenHash: string) {
  const { rows } = await db.query(
    `SELECT t.id, t.user_id, t.expires_at, t.consumed_at,
            u.username, u.email, u.display_name, u.status, u.company_id,
            c.name AS "companyName", c.active AS "companyActive"
       FROM ${T.userTokens} t
       JOIN ${T.users} u ON u.id = t.user_id
       LEFT JOIN ${T.companies} c ON c.id = u.company_id
      WHERE t.token_hash = ? AND t.purpose = ?`,
    [tokenHash, PURPOSE_ACTIVATION]
  );
  return rows[0] || null;
}

async function consumeActivation(tokenId: string, conn?: Queryable): Promise<boolean> {
  const client = conn || db;
  const result = await client.query(
    `UPDATE ${T.userTokens} SET consumed_at = now() WHERE id = ? AND consumed_at IS NULL`,
    [tokenId]
  );
  return result.rowCount! > 0;
}

export {
  insertRefresh,
  markRotated,
  revokeFamily,
  revokeAllForUser,
  revokeAllForCompany,
  findRefreshByHash,
  pruneExpiredRefresh,
  listSessions,
  retireActivations,
  insertActivation,
  findActivationByHash,
  consumeActivation,
};
