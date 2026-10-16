import { describe, expect, it } from 'vitest';
import { constraintOf, dbMessage, sqlState } from '../../src/tools/dbError';

const adapterError = {
  code: 'P2002',
  message: 'Unique constraint failed',
  meta: {
    driverAdapterError: {
      cause: {
        originalCode: '23505',
        originalMessage: 'duplicate key value violates unique constraint "users_email_key"',
        constraint: { index: 'users_email_key' },
      },
    },
  },
};

const pgError = { code: '23503', message: 'insert violates foreign key', constraint: 'fk_users_company' };

describe('sqlState', () => {
  it('reads the PostgreSQL code a Prisma driver adapter error carries', () => {
    expect(sqlState(adapterError)).toBe('23505');
  });

  it('reads the code of a pg driver error', () => {
    expect(sqlState(pgError)).toBe('23503');
  });

  it('ignores codes that are not SQLSTATEs', () => {
    expect(sqlState({ code: 'ECONNREFUSED' })).toBeUndefined();
  });

  it('copes with values that are not errors', () => {
    expect(sqlState(undefined)).toBeUndefined();
    expect(sqlState('boom')).toBeUndefined();
  });
});

describe('dbMessage', () => {
  it('prefers the database message over the Prisma one', () => {
    expect(dbMessage(adapterError)).toBe('duplicate key value violates unique constraint "users_email_key"');
  });

  it('falls back to the error message, then to the value itself', () => {
    expect(dbMessage(new Error('socket hang up'))).toBe('socket hang up');
    expect(dbMessage('plain text')).toBe('plain text');
  });
});

describe('constraintOf', () => {
  it('names the violated constraint from either driver', () => {
    expect(constraintOf(adapterError)).toBe('users_email_key');
    expect(constraintOf(pgError)).toBe('fk_users_company');
  });

  it('is undefined when the error names none', () => {
    expect(constraintOf(new Error('x'))).toBeUndefined();
  });
});
