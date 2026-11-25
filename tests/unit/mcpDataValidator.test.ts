import { describe, expect, it } from 'vitest';
import {
  contextKeyOf,
  decodeCursor,
  encodeCursor,
  entryFilterOf,
  nextCursor,
  objectTypesOf,
  pageWindow,
  qualifiedNameOf,
  searchWordsOf,
  versionOf,
} from '../../src/modules/mcp/mcpDataValidator';
import { errorCode } from './support/errorCode';

describe('pageWindow', () => {
  it('defaults to the first 25 items', () => {
    expect(pageWindow({})).toEqual({ offset: 0, limit: 25 });
    expect(pageWindow({ limit: '', cursor: '' })).toEqual({ offset: 0, limit: 25 });
  });

  it('accepts a limit from 1 to 100 and refuses anything else', () => {
    expect(pageWindow({ limit: '1' }).limit).toBe(1);
    expect(pageWindow({ limit: '100' }).limit).toBe(100);
    for (const limit of ['0', '101', '-5', '2.5', 'ten', ['5', '6']]) {
      expect(errorCode(() => pageWindow({ limit }))).toBe('VALIDATION_ERROR');
    }
  });

  it('continues from the cursor it issued', () => {
    const window = { offset: 25, limit: 25 };
    const cursor = nextCursor(window, 80);
    expect(cursor).not.toBeNull();
    expect(pageWindow({ cursor: cursor ?? '' })).toEqual({ offset: 50, limit: 25 });
    expect(nextCursor({ offset: 75, limit: 25 }, 80)).toBeNull();
    expect(nextCursor({ offset: 0, limit: 25 }, 25)).toBeNull();
  });

  it('refuses a cursor it did not issue', () => {
    for (const cursor of ['nonsense', encodeCursor(-1), Buffer.from('{"o":"5"}').toString('base64url'), '%%%']) {
      expect(errorCode(() => pageWindow({ cursor }))).toBe('VALIDATION_ERROR');
    }
    expect(decodeCursor(encodeCursor(40))).toBe(40);
  });
});

describe('versionOf', () => {
  it('reads 3 and v3 and defaults to the live version', () => {
    expect(versionOf('3')).toBe(3);
    expect(versionOf('v3')).toBe(3);
    expect(versionOf('V12')).toBe(12);
    expect(versionOf(undefined)).toBeNull();
    expect(versionOf('')).toBeNull();
  });

  it('refuses anything that is not a published version number', () => {
    for (const version of ['0', 'v0', 'latest', '1.5', '-1', ['1', '2']]) {
      expect(errorCode(() => versionOf(version))).toBe('VALIDATION_ERROR');
    }
  });
});

describe('objectTypesOf', () => {
  it('reads one or more comma-separated types', () => {
    expect(objectTypesOf('metric')).toEqual(['metric']);
    expect(objectTypesOf(' metric , glossary,metric ')).toEqual(['metric', 'glossary']);
    expect(objectTypesOf(undefined)).toBeNull();
    expect(objectTypesOf('  ')).toBeNull();
  });

  it('refuses a type the context layer does not have', () => {
    expect(errorCode(() => objectTypesOf('metric,secrets'))).toBe('VALIDATION_ERROR');
  });
});

describe('searchWordsOf', () => {
  it('splits on whitespace, drops repeats and keeps at most 8 words', () => {
    expect(searchWordsOf('  Revenue   revenue EU ')).toEqual(['revenue', 'eu']);
    expect(searchWordsOf('a b c d e f g h i j')).toHaveLength(8);
    expect(searchWordsOf(undefined)).toEqual([]);
  });
});

describe('qualifiedNameOf and entryFilterOf', () => {
  it('requires a qualified name only where asked', () => {
    expect(qualifiedNameOf(undefined, false)).toBeNull();
    expect(errorCode(() => qualifiedNameOf('  ', true))).toBe('VALIDATION_ERROR');
    expect(errorCode(() => qualifiedNameOf('x'.repeat(501), true))).toBe('VALIDATION_ERROR');
    expect(qualifiedNameOf(' sales.orders ', true)).toBe('sales.orders');
  });

  it('combines type, exact name and keywords', () => {
    expect(entryFilterOf({ type: 'table', qualifiedName: 'sales.orders', q: 'eu orders' })).toEqual({
      types: ['table'],
      qualifiedName: 'sales.orders',
      words: ['eu', 'orders'],
    });
  });
});

describe('contextKeyOf', () => {
  it('reads the connection id and the decoded context name', () => {
    expect(
      contextKeyOf({ connectionId: 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11', name: 'Revenue & Orders / EU' })
    ).toEqual({ connectionId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', name: 'Revenue & Orders / EU' });
  });

  it('answers 404 for an id or name that cannot exist', () => {
    const id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    expect(errorCode(() => contextKeyOf({ connectionId: 'nope', name: 'Sales' }))).toBe('RESOURCE_NOT_FOUND');
    expect(errorCode(() => contextKeyOf({ connectionId: id, name: '' }))).toBe('RESOURCE_NOT_FOUND');
    expect(errorCode(() => contextKeyOf({ connectionId: id, name: 'x'.repeat(121) }))).toBe('RESOURCE_NOT_FOUND');
  });
});
