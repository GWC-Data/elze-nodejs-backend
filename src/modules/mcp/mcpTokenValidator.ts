import { fail } from '../../shared/errors/AppError';
import { bodyOf, requireString } from '../../shared/validation/commonValidator';

const MCP_TOKEN_LIMITS = {
  name: 100,
  minDays: 1,
  maxDays: 365,
  defaultDays: 90,
  activePerUser: 10,
} as const;

interface NewMcpToken {
  name: string;
  expiresInDays: number;
}

function expiryDays(value: unknown): number {
  if (value === undefined || value === null) return MCP_TOKEN_LIMITS.defaultDays;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < MCP_TOKEN_LIMITS.minDays ||
    value > MCP_TOKEN_LIMITS.maxDays
  ) {
    throw fail(
      'VALIDATION_ERROR',
      `Expiry must be a whole number of days from ${MCP_TOKEN_LIMITS.minDays} to ${MCP_TOKEN_LIMITS.maxDays}.`
    );
  }
  return value;
}

function cleanNewToken(body: unknown): NewMcpToken {
  const input = bodyOf(body);
  return {
    name: requireString(input.name, 'Token name', { max: MCP_TOKEN_LIMITS.name }),
    expiresInDays: expiryDays(input.expiresInDays),
  };
}

export { MCP_TOKEN_LIMITS, cleanNewToken };
export type { NewMcpToken };
