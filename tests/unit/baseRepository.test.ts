import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../src/generated/prisma/client';
import {
  companyScope,
  numericRow,
  orNotFound,
  pagedRows,
  plain,
  plainRow,
  rawRows,
  sqlOf,
} from '../../src/shared/db/baseRepository';
import { rejectionCode } from './support/errorCode';

function fakeTx(...results: Record<string, unknown>[][]) {
  const $queryRaw = vi.fn();
  for (const rows of results) $queryRaw.mockResolvedValueOnce(rows);
  return { $queryRaw } as any;
}

describe('plain', () => {
  it('turns BigInt and Decimal into numbers', () => {
    expect(plain(42n)).toBe(42);
    expect(plain(new Prisma.Decimal('12.50'))).toBe(12.5);
  });

  it('leaves everything else alone', () => {
    const when = new Date('2026-10-16T00:00:00Z');
    expect(plain('7')).toBe('7');
    expect(plain(null)).toBeNull();
    expect(plain(when)).toBe(when);
  });

  it('converts every column of a row', () => {
    expect(plainRow({ id: 3n, total: new Prisma.Decimal('1.5'), name: 'x' })).toEqual({ id: 3, total: 1.5, name: 'x' });
  });

  it('makes every column of a numeric row a number', () => {
    expect(numericRow({ users: 4n, share: '0.25', ratio: new Prisma.Decimal('2') })).toEqual({
      users: 4,
      share: 0.25,
      ratio: 2,
    });
  });
});

describe('sqlOf', () => {
  it('binds each ? to a parameter instead of inlining it', () => {
    const query = sqlOf('SELECT * FROM users WHERE email = ? AND company_id = ?', ["x' OR 1=1 --", 7]);
    expect(query.text).toBe('SELECT * FROM users WHERE email = $1 AND company_id = $2');
    expect(query.values).toEqual(["x' OR 1=1 --", 7]);
  });

  it('does not treat a ? inside a literal as a placeholder', () => {
    const query = sqlOf("SELECT '?' AS mark, a FROM t WHERE a = ?", [1]);
    expect(query.text).toBe("SELECT '?' AS mark, a FROM t WHERE a = $1");
  });

  it('refuses a parameter count that does not match the placeholders', () => {
    expect(() => sqlOf('a = ? AND b = ?', [1])).toThrow('SQL has 2 placeholder(s) but 1 parameter(s) were given.');
  });
});

describe('companyScope', () => {
  it('does not narrow a platform account', () => {
    expect(companyScope({ isPlatform: true, companyId: null }, 'u.company_id').text).toBe('TRUE');
  });

  it('binds a company account to its own company id', () => {
    const scope = companyScope({ isPlatform: false, companyId: 12 }, 'u.company_id');
    expect(scope.text).toBe('u.company_id = $1');
    expect(scope.values).toEqual([12]);
  });
});

describe('rawRows and pagedRows', () => {
  it('returns plain rows', async () => {
    const tx = fakeTx([{ id: 1n }, { id: 2n }]);
    await expect(rawRows(tx, sqlOf('SELECT id FROM t'))).resolves.toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('takes the total from the window column when the page has rows', async () => {
    const tx = fakeTx([
      { id: 1n, __total: 41n },
      { id: 2n, __total: 41n },
    ]);
    const page = await pagedRows(tx, sqlOf('page'), sqlOf('count'), (row) => row.id);
    expect(page).toEqual({ items: [1, 2], total: 41 });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('runs the count query when the page is empty', async () => {
    const tx = fakeTx([], [{ n: 41n }]);
    const page = await pagedRows(tx, sqlOf('page'), sqlOf('count'), (row) => row.id);
    expect(page).toEqual({ items: [], total: 41 });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });
});

describe('orNotFound', () => {
  it('passes the value through', async () => {
    await expect(orNotFound(Promise.resolve('row'), 'missing')).resolves.toBe('row');
  });

  it('turns an id that is not a valid uuid into a 404', async () => {
    const badUuid = Promise.reject({ code: '22P02', message: 'invalid input syntax for type uuid' });
    expect(await rejectionCode(() => orNotFound(badUuid, 'That connection does not exist.'))).toBe(
      'RESOURCE_NOT_FOUND'
    );
  });

  it('rethrows any other database error', async () => {
    const outage = Promise.reject(Object.assign(new Error('connection refused'), { code: '08006' }));
    expect(await rejectionCode(() => orNotFound(outage, 'missing'))).toBe('08006');
  });
});
