import crypto from 'node:crypto';
import config from '../../config';
import * as tokenRepository from './tokenRepository';
import { TOKEN_PURPOSE } from './tokenRepository';
import * as loginAttemptRepository from './loginAttemptRepository';
import { fail } from '../../shared/errors/AppError';
import { hashToken, randomToken } from '../../shared/security/hash';
import { USER_STATUS } from '../../shared/db/statuses';
import type { Tx } from '../../shared/db/database';

const { withTransaction } = config.database;
const {
  PASSWORD_RESET_TOKEN_TTL_SECONDS,
  PASSWORD_RESET_MAX_REQUESTS,
  PASSWORD_RESET_WINDOW_SECONDS,
  APPLICATION_URL,
} = config.auth;

const THROTTLE_PREFIX = 'reset:';

function throttleKey(identifier: string): string {
  return `${THROTTLE_PREFIX}${identifier.trim().toLowerCase()}`.slice(0, 190);
}

async function assertResetRequestAllowed(identifier: string): Promise<void> {
  const lockedUntil = await loginAttemptRepository.lockedUntil(throttleKey(identifier));
  if (!lockedUntil) return;

  const until = new Date(lockedUntil).getTime();
  if (until <= Date.now()) return;

  const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60000));
  throw fail(
    'RATE_LIMITED',
    `Too many password reset requests. You can ask for a new link in ${minutes} minute${minutes === 1 ? '' : 's'}.`
  );
}

async function recordResetRequest(identifier: string): Promise<void> {
  await loginAttemptRepository.recordFailure(throttleKey(identifier), {
    windowSeconds: PASSWORD_RESET_WINDOW_SECONDS,
    maxAttempts: PASSWORD_RESET_MAX_REQUESTS,
    lockoutSeconds: PASSWORD_RESET_WINDOW_SECONDS,
  });
}

async function hasResetAllowance(userId: string): Promise<boolean> {
  const since = new Date(Date.now() - PASSWORD_RESET_WINDOW_SECONDS * 1000);
  return (
    (await tokenRepository.countIssuedSince(userId, TOKEN_PURPOSE.PASSWORD_RESET, since)) < PASSWORD_RESET_MAX_REQUESTS
  );
}

async function issueResetToken(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const raw = randomToken();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_SECONDS * 1000);

  await withTransaction(async (conn: Tx) => {
    await tokenRepository.retireTokens(userId, TOKEN_PURPOSE.PASSWORD_RESET, conn);
    await tokenRepository.insertToken(
      {
        id: crypto.randomUUID(),
        userId,
        purpose: TOKEN_PURPOSE.PASSWORD_RESET,
        tokenHash: hashToken(raw),
        expiresAt,
        createdBy: null,
      },
      conn
    );
  });

  return { token: raw, expiresAt };
}

function resetUrl(token: string): string {
  return `${APPLICATION_URL}/reset-password?token=${encodeURIComponent(token)}`;
}

async function resolveResetToken(raw: unknown) {
  if (!raw || typeof raw !== 'string') {
    throw fail('INVALID_RESET_TOKEN', 'That password reset link is not valid.');
  }

  const row = await tokenRepository.findTokenByHash(hashToken(raw), TOKEN_PURPOSE.PASSWORD_RESET);

  const invalid = () =>
    fail(
      'INVALID_RESET_TOKEN',
      'That password reset link is no longer valid. Request a new one from the sign-in page.'
    );

  if (!row) throw invalid();
  if (row.consumed_at) throw invalid();
  if (new Date(row.expires_at).getTime() <= Date.now()) throw invalid();
  if (row.status === USER_STATUS.DISABLED) {
    throw fail('ACCOUNT_DISABLED', 'This account has been deactivated.');
  }
  if (row.status !== USER_STATUS.ACTIVE) throw invalid();
  if (row.company_id && !row.companyActive) {
    throw fail('COMPANY_DISABLED', 'This company is not currently active.');
  }

  return row;
}

async function consumeResetToken(tokenId: string, conn?: Tx): Promise<void> {
  if (!(await tokenRepository.consumeToken(tokenId, conn))) {
    throw fail('INVALID_RESET_TOKEN', 'That password reset link has already been used.');
  }
}

async function retireResetTokens(userId: string, conn?: Tx): Promise<void> {
  await tokenRepository.retireTokens(userId, TOKEN_PURPOSE.PASSWORD_RESET, conn);
}

export {
  assertResetRequestAllowed,
  recordResetRequest,
  hasResetAllowance,
  issueResetToken,
  resetUrl,
  resolveResetToken,
  consumeResetToken,
  retireResetTokens,
};
