import crypto from 'node:crypto';
import config from '../../config';
import { codeOf, fail } from '../../shared/errors/AppError';
import { hashToken } from '../../shared/security/hash';
import { bodyOf, isUuid } from '../../shared/validation/commonValidator';
import { assertPermission, can } from '../auth/authorizationService';
import { requireManageable, requireUserInScope } from '../users/userService';
import { audit, EVENTS } from '../audit/auditService';
import * as mcpTokenRepository from './mcpTokenRepository';
import { cleanNewToken, MCP_TOKEN_LIMITS } from './mcpTokenValidator';
import { displayPrefix, newTokenValue } from './mcpTokenFormat';
import { shapeIssued, shapeToken } from './mcpTokenSerializer';
import type { Actor } from '../../shared/types/actor';
import type { IssuedMcpToken, McpTokenView } from './mcpTokenSerializer';

const { withTransaction } = config.database;

const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN_NOT_FOUND = 'MCP token not found.';
const USER_NOT_FOUND = 'User not found';
const REVOKED_BY = { owner: 'revoked_by_owner', admin: 'revoked_by_admin' } as const;

interface TokenHolder {
  id: string;
  companyId: string | null;
}

function self(actor: Actor): TokenHolder {
  return { id: actor.id, companyId: actor.companyId };
}

function namesSomeoneElse(actor: Actor, userId: unknown): boolean {
  if (userId === undefined || userId === null || userId === '') return false;
  return String(userId).toLowerCase() !== actor.id.toLowerCase();
}

async function visibleHolder(actor: Actor, userId: unknown): Promise<TokenHolder> {
  if (!namesSomeoneElse(actor, userId)) return self(actor);
  assertPermission(actor, 'user.read');
  if (!isUuid(userId)) throw fail('RESOURCE_NOT_FOUND', USER_NOT_FOUND);
  const user = await requireUserInScope(actor, userId);
  return { id: user.id, companyId: user.company_id };
}

async function manageableHolder(actor: Actor, userId: unknown): Promise<TokenHolder> {
  if (!namesSomeoneElse(actor, userId)) return self(actor);
  assertPermission(actor, 'user.deactivate');
  if (!isUuid(userId)) throw fail('RESOURCE_NOT_FOUND', USER_NOT_FOUND);
  const user = await requireManageable(actor, userId);
  return { id: user.id, companyId: user.company_id };
}

async function tokenHolder(actor: Actor, userId: string): Promise<TokenHolder> {
  try {
    return await manageableHolder(actor, userId);
  } catch (err) {
    if (codeOf(err) === 'RESOURCE_NOT_FOUND') throw fail('RESOURCE_NOT_FOUND', TOKEN_NOT_FOUND);
    throw err;
  }
}

async function createToken(actor: Actor, body: unknown): Promise<IssuedMcpToken> {
  assertPermission(actor, 'context.read');
  const { name, expiresInDays } = cleanNewToken(body);
  const token = newTokenValue();
  const now = new Date();

  const row = await withTransaction(async (tx) => {
    await mcpTokenRepository.lockHolder(tx, actor.id);
    const active = await mcpTokenRepository.countActive(actor.id, now, tx);
    if (active >= MCP_TOKEN_LIMITS.activePerUser) {
      throw fail(
        'CONFLICT',
        `You already have ${MCP_TOKEN_LIMITS.activePerUser} active MCP tokens. Revoke one before creating another.`
      );
    }
    return mcpTokenRepository.insertToken(
      {
        id: crypto.randomUUID(),
        userId: actor.id,
        name,
        tokenPrefix: displayPrefix(token),
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + expiresInDays * DAY_MS),
      },
      tx
    );
  });

  audit(EVENTS.MCP_TOKEN_CREATED, actor, {
    tokenId: row.id,
    tokenName: row.name,
    prefix: row.tokenPrefix,
    expiresAt: row.expiresAt.toISOString(),
    userId: actor.id,
  });
  return shapeIssued(row, token, now);
}

async function listTokens(actor: Actor, userId: unknown): Promise<McpTokenView[]> {
  const holder = await visibleHolder(actor, userId);
  const now = new Date();
  const rows = await mcpTokenRepository.listForUser(holder.id);
  return rows.map((row) => shapeToken(row, now));
}

async function revokeToken(actor: Actor, id: unknown): Promise<McpTokenView> {
  const row = isUuid(id) ? await mcpTokenRepository.findById(id) : null;
  if (!row) throw fail('RESOURCE_NOT_FOUND', TOKEN_NOT_FOUND);

  const own = row.userId === actor.id;
  if (!own && !can(actor, 'user.deactivate')) throw fail('RESOURCE_NOT_FOUND', TOKEN_NOT_FOUND);
  const holder = own ? self(actor) : await tokenHolder(actor, row.userId);

  const reason = own ? REVOKED_BY.owner : REVOKED_BY.admin;
  const revoked = await mcpTokenRepository.revoke(row.id, actor.id, reason);
  if (!revoked) throw fail('CONFLICT', 'That MCP token is already revoked.');

  audit(EVENTS.MCP_TOKEN_REVOKED, actor, {
    tokenId: row.id,
    tokenName: row.name,
    prefix: row.tokenPrefix,
    reason,
    userId: holder.id,
    companyId: holder.companyId,
  });
  return shapeToken(revoked);
}

async function revokeAllTokens(actor: Actor, body: unknown): Promise<{ revoked: number }> {
  const holder = await manageableHolder(actor, bodyOf(body).userId);
  const reason = holder.id === actor.id ? REVOKED_BY.owner : REVOKED_BY.admin;
  const revoked = await mcpTokenRepository.revokeActiveForUser(holder.id, actor.id, reason);

  if (revoked > 0) {
    audit(EVENTS.MCP_TOKEN_REVOKED, actor, {
      all: true,
      count: revoked,
      reason,
      userId: holder.id,
      companyId: holder.companyId,
    });
  }
  return { revoked };
}

export { createToken, listTokens, revokeToken, revokeAllTokens };
