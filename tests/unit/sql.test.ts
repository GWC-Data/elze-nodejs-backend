import { describe, expect, it } from 'vitest';
import { escapeLiteral, quoteIdentifier, quoteQualified, splitPlaceholders } from '../../src/tools/sql';

describe('quoteIdentifier', () => {
  it('wraps a name in double quotes', () => {
    expect(quoteIdentifier('Movie Name')).toBe('"Movie Name"');
  });

  it('doubles embedded double quotes so a name cannot close the identifier', () => {
    expect(quoteIdentifier('a"; DROP TABLE users; --')).toBe('"a""; DROP TABLE users; --"');
  });

  it('quotes a schema and table separately', () => {
    expect(quoteQualified('public', 'cinema analysis')).toBe('"public"."cinema analysis"');
  });
});

describe('escapeLiteral', () => {
  it('doubles single quotes', () => {
    expect(escapeLiteral("O'Brien's")).toBe("O''Brien''s");
  });
});

describe('splitPlaceholders', () => {
  it('splits on each question mark', () => {
    expect(splitPlaceholders('a = ? AND b = ?')).toEqual(['a = ', ' AND b = ', '']);
  });

  it('returns the whole text when there is no placeholder', () => {
    expect(splitPlaceholders('SELECT 1')).toEqual(['SELECT 1']);
  });

  it('ignores question marks inside string literals, including escaped quotes', () => {
    expect(splitPlaceholders("SELECT 'it''s ?' WHERE a = ?")).toEqual(["SELECT 'it''s ?' WHERE a = ", '']);
  });

  it('ignores question marks inside quoted identifiers', () => {
    expect(splitPlaceholders('SELECT "why?" FROM t WHERE a = ?')).toEqual(['SELECT "why?" FROM t WHERE a = ', '']);
  });

  it('ignores question marks inside line and block comments', () => {
    const sql = 'SELECT 1 -- really?\nFROM t /* or? */ WHERE a = ?';
    expect(splitPlaceholders(sql)).toEqual(['SELECT 1 -- really?\nFROM t /* or? */ WHERE a = ', '']);
  });

  it('keeps every character of the text across the pieces', () => {
    const sql = `SELECT "a?" , 'b?' -- c?\n, d FROM t WHERE x = ? AND y IN (?, ?)`;
    expect(splitPlaceholders(sql).join('?')).toBe(sql);
  });
});
