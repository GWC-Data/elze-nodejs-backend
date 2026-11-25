import crypto from 'node:crypto';

const TOKEN_PREFIX = 'elze_pat_';
const TOKEN_BYTES = 32;
const DISPLAY_PREFIX_LENGTH = 16;
const TOKEN_PATTERN = /^elze_pat_[A-Za-z0-9_-]{43}$/;
const MCP_READ_SCOPE = 'mcp:read';

function newTokenValue(): string {
  return `${TOKEN_PREFIX}${crypto.randomBytes(TOKEN_BYTES).toString('base64url')}`;
}

function isTokenFormat(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

function displayPrefix(token: string): string {
  return token.slice(0, DISPLAY_PREFIX_LENGTH);
}

export { TOKEN_PREFIX, DISPLAY_PREFIX_LENGTH, MCP_READ_SCOPE, newTokenValue, isTokenFormat, displayPrefix };
