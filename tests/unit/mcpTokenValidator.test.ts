import { describe, expect, it } from 'vitest';
import {
  DISPLAY_PREFIX_LENGTH,
  displayPrefix,
  isTokenFormat,
  newTokenValue,
} from '../../src/modules/mcp/mcpTokenFormat';
import { cleanNewToken, MCP_TOKEN_LIMITS } from '../../src/modules/mcp/mcpTokenValidator';
import { statusOf } from '../../src/modules/mcp/mcpTokenSerializer';
import { errorCode } from './support/errorCode';

describe('newTokenValue', () => {
  it('is elze_pat_ followed by 43 base64url characters', () => {
    const token = newTokenValue();
    expect(token).toMatch(/^elze_pat_[A-Za-z0-9_-]{43}$/);
    expect(token).toHaveLength(52);
    expect(isTokenFormat(token)).toBe(true);
  });

  it('never repeats', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => newTokenValue()));
    expect(tokens.size).toBe(500);
  });

  it('shows its first 16 characters as the prefix', () => {
    const token = newTokenValue();
    expect(DISPLAY_PREFIX_LENGTH).toBe(16);
    expect(displayPrefix(token)).toBe(token.slice(0, 16));
    expect(displayPrefix(token).startsWith('elze_pat_')).toBe(true);
  });
});

describe('isTokenFormat', () => {
  it('refuses anything that is not exactly one token', () => {
    const token = newTokenValue();
    expect(isTokenFormat(token.slice(0, -1))).toBe(false);
    expect(isTokenFormat(`${token}x`)).toBe(false);
    expect(isTokenFormat(token.replace('elze_pat_', 'elze_tok_'))).toBe(false);
    expect(isTokenFormat(`Bearer ${token}`)).toBe(false);
    expect(isTokenFormat(` ${token}`)).toBe(false);
    expect(isTokenFormat(undefined)).toBe(false);
    expect(isTokenFormat(42)).toBe(false);
  });
});

describe('cleanNewToken', () => {
  it('trims the name and defaults the expiry to 90 days', () => {
    expect(cleanNewToken({ name: '  Claude Desktop  ' })).toEqual({ name: 'Claude Desktop', expiresInDays: 90 });
    expect(cleanNewToken({ name: 'x', expiresInDays: null }).expiresInDays).toBe(MCP_TOKEN_LIMITS.defaultDays);
  });

  it('accepts every whole number of days from 1 to 365', () => {
    for (const days of [1, 30, 90, 180, 365]) {
      expect(cleanNewToken({ name: 'x', expiresInDays: days }).expiresInDays).toBe(days);
    }
  });

  it('refuses an expiry outside 1 to 365 whole days instead of clamping it', () => {
    for (const days of [0, -1, 366, 400, 1.5, '30', Number.NaN, Number.POSITIVE_INFINITY, true, '']) {
      expect(errorCode(() => cleanNewToken({ name: 'x', expiresInDays: days }))).toBe('VALIDATION_ERROR');
    }
  });

  it('requires a name of at most 100 characters', () => {
    expect(errorCode(() => cleanNewToken({}))).toBe('VALIDATION_ERROR');
    expect(errorCode(() => cleanNewToken({ name: '   ' }))).toBe('VALIDATION_ERROR');
    expect(errorCode(() => cleanNewToken({ name: 7 }))).toBe('VALIDATION_ERROR');
    expect(errorCode(() => cleanNewToken({ name: 'a'.repeat(101) }))).toBe('VALIDATION_ERROR');
    expect(cleanNewToken({ name: 'a'.repeat(100) }).name).toHaveLength(100);
  });

  it('treats a missing body as an empty one', () => {
    expect(errorCode(() => cleanNewToken(undefined))).toBe('VALIDATION_ERROR');
  });
});

describe('statusOf', () => {
  const now = new Date('2026-11-06T12:00:00Z');
  const later = new Date('2026-12-06T12:00:00Z');

  it('is active before the expiry and expired from it on', () => {
    expect(statusOf({ revokedAt: null, expiresAt: later }, now)).toBe('active');
    expect(statusOf({ revokedAt: null, expiresAt: now }, now)).toBe('expired');
  });

  it('reports a revoked token as revoked even before its expiry', () => {
    expect(statusOf({ revokedAt: now, expiresAt: later }, now)).toBe('revoked');
  });
});
