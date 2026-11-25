import config from '../../config';
import { Prisma } from '../../generated/prisma/client';
import { rawRows } from '../../shared/db/baseRepository';
import type { Tx } from '../../shared/db/database';

const { prisma } = config.database;

const TOKEN_FIELDS = {
  id: true,
  userId: true,
  name: true,
  tokenPrefix: true,
  scope: true,
  createdAt: true,
  expiresAt: true,
  lastUsedAt: true,
  revokedAt: true,
  revokedReason: true,
} as const;

interface McpTokenRow {
  id: string;
  userId: string;
  name: string;
  tokenPrefix: string;
  scope: string;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
}

interface PresentedTokenRow extends McpTokenRow {
  user: { username: string; companyId: string | null };
}

interface NewTokenRow {
  id: string;
  userId: string;
  name: string;
  tokenPrefix: string;
  tokenHash: string;
  expiresAt: Date;
}

async function lockHolder(tx: Tx, userId: string): Promise<void> {
  await rawRows<{ id: string }>(tx, Prisma.sql`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`);
}

async function countActive(userId: string, now: Date, tx: Tx = prisma): Promise<number> {
  return tx.mcpToken.count({ where: { userId, revokedAt: null, expiresAt: { gt: now } } });
}

async function insertToken(row: NewTokenRow, tx: Tx = prisma): Promise<McpTokenRow> {
  return tx.mcpToken.create({ data: row, select: TOKEN_FIELDS });
}

async function listForUser(userId: string): Promise<McpTokenRow[]> {
  return prisma.mcpToken.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    select: TOKEN_FIELDS,
  });
}

async function findById(id: string): Promise<McpTokenRow | null> {
  return prisma.mcpToken.findUnique({ where: { id }, select: TOKEN_FIELDS });
}

async function revoke(id: string, revokedBy: string, reason: string): Promise<McpTokenRow | null> {
  const result = await prisma.mcpToken.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date(), revokedBy, revokedReason: reason },
  });
  return result.count > 0 ? findById(id) : null;
}

async function revokeActiveForUser(userId: string, revokedBy: string, reason: string): Promise<number> {
  const now = new Date();
  const result = await prisma.mcpToken.updateMany({
    where: { userId, revokedAt: null, expiresAt: { gt: now } },
    data: { revokedAt: now, revokedBy, revokedReason: reason },
  });
  return result.count;
}

async function findByHash(tokenHash: string): Promise<PresentedTokenRow | null> {
  return prisma.mcpToken.findUnique({
    where: { tokenHash },
    select: { ...TOKEN_FIELDS, user: { select: { username: true, companyId: true } } },
  });
}

async function touchLastUsed(id: string, now: Date, everyMs: number): Promise<void> {
  await prisma.mcpToken.updateMany({
    where: { id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now.getTime() - everyMs) } }] },
    data: { lastUsedAt: now },
  });
}

export {
  lockHolder,
  countActive,
  insertToken,
  listForUser,
  findById,
  revoke,
  revokeActiveForUser,
  findByHash,
  touchLastUsed,
};
export type { McpTokenRow, NewTokenRow, PresentedTokenRow };
