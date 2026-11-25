import type { NextFunction, Request, Response } from 'express';
import TtlCache from '../../shared/cache/ttlCache';
import { codeOf, fail, messageOf } from '../../shared/errors/AppError';
import { hashToken } from '../../shared/security/hash';
import { actorForUser } from '../auth/authMiddleware';
import { audit, EVENTS } from '../audit/auditService';
import * as mcpTokenRepository from './mcpTokenRepository';
import { isTokenFormat, MCP_READ_SCOPE } from './mcpTokenFormat';
import type { ApiError } from '../../shared/errors/AppError';
import type { Actor } from '../../shared/types/actor';
import type { PresentedTokenRow } from './mcpTokenRepository';

const REALM = 'Bearer realm="elze-mcp"';
const LAST_USED_EVERY_MS = 60 * 1000;
const REJECTION_AUDIT_EVERY_MS = 10 * 60 * 1000;

const TOKEN_REFUSALS = {
  revoked: 'This MCP token has been revoked. Create a new one in Elze.',
  expired: 'This MCP token has expired. Create a new one in Elze.',
  scope: 'This MCP token cannot read contexts.',
} as const;

type TokenRefusal = keyof typeof TOKEN_REFUSALS;

const ACCOUNT_REFUSALS: Readonly<Record<string, string>> = {
  UNAUTHENTICATED: 'account_missing',
  ACCOUNT_DISABLED: 'account_disabled',
  ACCOUNT_PENDING_ACTIVATION: 'account_pending',
  COMPANY_DISABLED: 'company_disabled',
};

const recentRejections = new TtlCache<true>(REJECTION_AUDIT_EVERY_MS);

function presentedToken(req: Request): string | null {
  const header = req.get('authorization');
  const match = header ? /^Bearer +(\S+) *$/i.exec(header) : null;
  return match ? match[1] : null;
}

function challenge(res: Response, message: string, invalidToken: boolean): ApiError {
  res.set('WWW-Authenticate', invalidToken ? `${REALM}, error="invalid_token"` : REALM);
  return fail('UNAUTHENTICATED', message);
}

function tokenRefusal(row: PresentedTokenRow, now: Date): TokenRefusal | null {
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  if (row.scope !== MCP_READ_SCOPE) return 'scope';
  return null;
}

function rejected(row: PresentedTokenRow, reason: string): void {
  const key = `${row.id}:${reason}`;
  if (recentRejections.get(key)) return;
  recentRejections.set(key, true);
  audit(
    EVENTS.MCP_TOKEN_REJECTED,
    { id: row.userId, username: row.user.username, companyId: row.user.companyId },
    { tokenId: row.id, prefix: row.tokenPrefix, reason, userId: row.userId }
  );
}

async function holderOf(row: PresentedTokenRow, res: Response): Promise<Actor | ApiError> {
  try {
    const { actor } = await actorForUser(row.userId);
    if (!actor.mustChangePassword) return actor;
    rejected(row, 'password_change_required');
    return challenge(res, 'Sign in to Elze and choose a new password before using this token.', true);
  } catch (err) {
    const reason = ACCOUNT_REFUSALS[String(codeOf(err))];
    if (!reason) throw err;
    rejected(row, reason);
    return challenge(res, messageOf(err), true);
  }
}

async function requireMcpToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = presentedToken(req);
    if (!raw) {
      next(challenge(res, 'Send a personal MCP token as "Authorization: Bearer <token>".', false));
      return;
    }
    if (!isTokenFormat(raw)) {
      next(challenge(res, 'That is not an Elze MCP token.', true));
      return;
    }

    const row = await mcpTokenRepository.findByHash(hashToken(raw));
    if (!row) {
      next(challenge(res, 'This MCP token is not valid.', true));
      return;
    }

    const now = new Date();
    const refusal = tokenRefusal(row, now);
    if (refusal) {
      rejected(row, refusal);
      next(challenge(res, TOKEN_REFUSALS[refusal], true));
      return;
    }

    const holder = await holderOf(row, res);
    if (holder instanceof Error) {
      next(holder);
      return;
    }

    await mcpTokenRepository.touchLastUsed(row.id, now, LAST_USED_EVERY_MS);
    req.actor = holder;
    req.mcpTokenId = row.id;
    next();
  } catch (err) {
    next(err);
  }
}

export { requireMcpToken };
