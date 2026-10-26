import config from '../../config';
import { NOT_DELETED } from '../../shared/db/softDelete';
import type { Tx } from '../../shared/db/database';

const { prisma } = config.database;

const TOKEN_PURPOSE = {
  ACTIVATION: 'activation',
  PASSWORD_RESET: 'password_reset',
} as const;

type TokenPurpose = (typeof TOKEN_PURPOSE)[keyof typeof TOKEN_PURPOSE];

async function insertRefresh(
  {
    id,
    familyId,
    userId,
    tokenHash,
    expiresAt,
  }: {
    id: string;
    familyId: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  },
  tx: Tx = prisma
): Promise<void> {
  await tx.refreshToken.create({ data: { id, familyId, userId, tokenHash, expiresAt } });
}

async function markRotated(replacedId: string, byId: string, tx: Tx = prisma): Promise<void> {
  await tx.refreshToken.updateMany({
    where: { id: replacedId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: 'rotated', replacedBy: byId },
  });
}

async function revokeFamily(familyId: string, reason: string, tx: Tx = prisma): Promise<void> {
  await tx.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

async function revokeAllForUser(userId: string, reason: string, tx: Tx = prisma): Promise<number> {
  const result = await tx.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return result.count;
}

async function revokeAllForCompany(companyId: string, reason: string, tx: Tx = prisma): Promise<number> {
  const result = await tx.refreshToken.updateMany({
    where: { revokedAt: null, user: { companyId } },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return result.count;
}

async function findRefreshByHash(tokenHash: string) {
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!row) return null;
  return {
    id: row.id,
    family_id: row.familyId,
    user_id: row.userId,
    expires_at: row.expiresAt,
    revoked_at: row.revokedAt,
    revoked_reason: row.revokedReason,
  };
}

async function pruneExpiredRefresh(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const result = await prisma.refreshToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
  });
  return result.count;
}

async function listSessions(userId: string) {
  const groups = await prisma.refreshToken.groupBy({
    by: ['familyId'],
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    _max: { issuedAt: true },
    orderBy: { _max: { issuedAt: 'desc' } },
  });
  return groups.map((g) => ({ familyId: g.familyId, lastUsedAt: g._max.issuedAt }));
}

async function retireTokens(userId: string, purpose: TokenPurpose, tx: Tx = prisma): Promise<void> {
  await tx.userToken.updateMany({
    where: { userId, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });
}

async function insertToken(
  {
    id,
    userId,
    purpose,
    tokenHash,
    expiresAt,
    createdBy,
  }: {
    id: string;
    userId: string;
    purpose: TokenPurpose;
    tokenHash: string;
    expiresAt: Date;
    createdBy: string | null;
  },
  tx: Tx = prisma
): Promise<void> {
  await tx.userToken.create({
    data: { id, userId, purpose, tokenHash, expiresAt, createdBy },
  });
}

async function countIssuedSince(userId: string, purpose: TokenPurpose, since: Date): Promise<number> {
  return prisma.userToken.count({ where: { userId, purpose, createdAt: { gte: since } } });
}

async function findTokenByHash(tokenHash: string, purpose: TokenPurpose) {
  const row = await prisma.userToken.findFirst({
    where: { tokenHash, purpose, user: NOT_DELETED },
    include: { user: { include: { company: { select: { name: true, active: true } } } } },
  });
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.userId,
    expires_at: row.expiresAt,
    consumed_at: row.consumedAt,
    username: row.user.username,
    email: row.user.email,
    display_name: row.user.displayName,
    status: row.user.status,
    company_id: row.user.companyId,
    companyName: row.user.company ? row.user.company.name : null,
    companyActive: row.user.company ? row.user.company.active : null,
  };
}

async function consumeToken(tokenId: string, tx: Tx = prisma): Promise<boolean> {
  const result = await tx.userToken.updateMany({
    where: { id: tokenId, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  return result.count > 0;
}

async function pruneExpiredResets(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await prisma.userToken.deleteMany({
    where: { purpose: TOKEN_PURPOSE.PASSWORD_RESET, expiresAt: { lt: cutoff } },
  });
  return result.count;
}

export {
  TOKEN_PURPOSE,
  insertRefresh,
  markRotated,
  revokeFamily,
  revokeAllForUser,
  revokeAllForCompany,
  findRefreshByHash,
  pruneExpiredRefresh,
  listSessions,
  retireTokens,
  insertToken,
  countIssuedSince,
  findTokenByHash,
  consumeToken,
  pruneExpiredResets,
};
export type { TokenPurpose };
