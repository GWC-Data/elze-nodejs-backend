import crypto from 'node:crypto';
import config from '../../config';
import * as tokenRepository from './tokenRepository';
import { fail } from '../../shared/errors/AppError';
import { hashToken, randomToken } from '../../shared/security/hash';
import { signAccessToken, verifyAccessToken } from '../../shared/security/jwt';
import type { Tx } from '../../shared/db/database';

const { REFRESH_TOKEN_TTL_SECONDS } = config.auth;

const SESSION_ENDED = 'Your session has ended. Please sign in again.';

interface IssuedRefreshToken {
  id: string;
  familyId: string;
  token: string;
  expiresAt: Date;
}

function expiryDate(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}

async function issueRefreshToken(
  userId: number,
  { familyId, replaces, notAfter }: { familyId?: string; replaces?: string; notAfter?: Date } = {},
  conn?: Tx
): Promise<IssuedRefreshToken> {
  const id = crypto.randomUUID();
  const family = familyId || crypto.randomUUID();
  const raw = randomToken();
  const fullTerm = expiryDate(REFRESH_TOKEN_TTL_SECONDS);
  const expiresAt = notAfter && notAfter.getTime() < fullTerm.getTime() ? notAfter : fullTerm;

  await tokenRepository.insertRefresh({ id, familyId: family, userId, tokenHash: hashToken(raw), expiresAt }, conn);
  if (replaces) await tokenRepository.markRotated(replaces, id, conn);

  return { id, familyId: family, token: raw, expiresAt };
}

async function consumeRefreshToken(raw: unknown) {
  if (!raw || typeof raw !== 'string') {
    throw fail('INVALID_REFRESH_TOKEN', SESSION_ENDED);
  }

  const row = await tokenRepository.findRefreshByHash(hashToken(raw));
  if (!row) throw fail('INVALID_REFRESH_TOKEN', SESSION_ENDED);

  if (row.revoked_at) {
    await tokenRepository.revokeFamily(row.family_id, 'reuse_detected');
    console.warn(
      `[auth] refresh token reuse detected for user ${row.user_id}; ` +
        `family ${row.family_id} revoked (previous reason: ${row.revoked_reason})`
    );
    throw fail('INVALID_REFRESH_TOKEN', SESSION_ENDED);
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw fail('INVALID_REFRESH_TOKEN', SESSION_ENDED);
  }

  return row;
}

const revokeFamily = tokenRepository.revokeFamily;
const revokeAllForUser = tokenRepository.revokeAllForUser;
const revokeAllForCompany = tokenRepository.revokeAllForCompany;
async function pruneExpiredTokens(): Promise<number> {
  const [refresh, resets] = await Promise.all([
    tokenRepository.pruneExpiredRefresh(),
    tokenRepository.pruneExpiredResets(),
  ]);
  return refresh + resets;
}

const listSessions = tokenRepository.listSessions;

export {
  SESSION_ENDED,
  signAccessToken as issueAccessToken,
  verifyAccessToken,
  issueRefreshToken,
  consumeRefreshToken,
  revokeFamily,
  revokeAllForUser,
  revokeAllForCompany,
  pruneExpiredTokens,
  listSessions,
};
export type { IssuedRefreshToken };
