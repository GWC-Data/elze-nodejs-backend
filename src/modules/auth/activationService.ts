import crypto from 'node:crypto';
import config from '../../config';
import * as tokenRepository from './tokenRepository';
import { TOKEN_PURPOSE } from './tokenRepository';
import { fail } from '../../shared/errors/AppError';
import { hashToken, randomToken } from '../../shared/security/hash';
import { USER_STATUS } from '../../shared/db/statuses';
import type { Tx } from '../../shared/db/database';

const { ACTIVATION_TOKEN_TTL_SECONDS, APPLICATION_URL } = config.auth;

async function issueActivationToken(
  userId: number,
  issuedBy: number | null | undefined,
  conn?: Tx
): Promise<{ token: string; expiresAt: Date }> {
  await tokenRepository.retireTokens(userId, TOKEN_PURPOSE.ACTIVATION, conn);

  const raw = randomToken();
  const expiresAt = new Date(Date.now() + ACTIVATION_TOKEN_TTL_SECONDS * 1000);

  await tokenRepository.insertToken(
    {
      id: crypto.randomUUID(),
      userId,
      purpose: TOKEN_PURPOSE.ACTIVATION,
      tokenHash: hashToken(raw),
      expiresAt,
      createdBy: issuedBy || null,
    },
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

  const row = await tokenRepository.findTokenByHash(hashToken(raw), TOKEN_PURPOSE.ACTIVATION);

  const invalid = () =>
    fail(
      'INVALID_ACTIVATION_TOKEN',
      'That activation link is no longer valid. Ask your administrator to send a new one.'
    );

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

async function consumeActivationToken(tokenId: string, conn?: Tx): Promise<void> {
  if (!(await tokenRepository.consumeToken(tokenId, conn))) {
    throw fail('INVALID_ACTIVATION_TOKEN', 'That activation link has already been used.');
  }
}

export { issueActivationToken, activationUrl, resolveActivationToken, consumeActivationToken };
