import crypto from 'crypto';
import config from '../config';
import * as tokenRepository from '../repositories/token.repository';
import { fail } from '../tools/AppError';
import { hashToken, randomToken } from '../tools/hash';
import { USER_STATUS } from '../constants/statuses';
import type { Queryable } from '../config/pgPool';

const { ACTIVATION_TOKEN_TTL_SECONDS, APPLICATION_URL } = config.auth;

async function issueActivationToken(
  userId: number,
  issuedBy: number | null | undefined,
  conn?: Queryable
): Promise<{ token: string; expiresAt: Date }> {
  await tokenRepository.retireActivations(userId, conn);

  const raw = randomToken();
  const expiresAt = new Date(Date.now() + ACTIVATION_TOKEN_TTL_SECONDS * 1000);

  await tokenRepository.insertActivation(
    { id: crypto.randomUUID(), userId, tokenHash: hashToken(raw), expiresAt, createdBy: issuedBy || null },
    conn
  );

  return { token: raw, expiresAt };
}

function activationUrl(token: string): string {
  return `${APPLICATION_URL}/activate?token=${encodeURIComponent(token)}`;
}

async function resolveActivationToken(raw: unknown) {
  if (!raw || typeof raw !== 'string') {
    throw fail('INVALID_ACTIVATION_TOKEN', 'That activation link is not valid.');
  }

  const row = await tokenRepository.findActivationByHash(hashToken(raw));

  const invalid = () =>
    fail('INVALID_ACTIVATION_TOKEN', 'That activation link is no longer valid. Ask your administrator to send a new one.');

  if (!row) throw invalid();
  if (row.consumed_at) throw invalid();
  if (new Date(row.expires_at).getTime() <= Date.now()) throw invalid();
  if (row.status === USER_STATUS.DISABLED) {
    throw fail('ACCOUNT_DISABLED', 'This account has been deactivated.');
  }
  if (row.company_id && !row.companyActive) {
    throw fail('COMPANY_DISABLED', 'This company is not currently active.');
  }

  return row;
}

async function consumeActivationToken(tokenId: string, conn?: Queryable): Promise<void> {
  if (!(await tokenRepository.consumeActivation(tokenId, conn))) {
    throw fail('INVALID_ACTIVATION_TOKEN', 'That activation link has already been used.');
  }
}

export { issueActivationToken, activationUrl, resolveActivationToken, consumeActivationToken };
