import { describe, expect, it } from 'vitest';
import { MAX_PAGE_SIZE, MAX_SEARCH_LENGTH } from '../../src/shared/validation/pageLimits';
import { parseListQuery } from '../../src/shared/validation/listValidator';
import { errorCode } from './support/errorCode';

const SORTABLE = { name: 'u.name', created: 'u.created_at' };

describe('parseListQuery', () => {
  it('falls back to page 1, the default page size and ascending order', () => {
    expect(parseListQuery({}, SORTABLE)).toEqual({
      page: 1,
      pageSize: 25,
      offset: 0,
      search: '',
      sort: undefined,
      dir: 'asc',
    });
  });

  it('uses the defaults a list passes in', () => {
    const query = parseListQuery({}, SORTABLE, { pageSize: 10, sort: 'created', dir: 'desc' });
    expect(query).toMatchObject({ pageSize: 10, sort: 'created', dir: 'desc' });
  });

  it('computes the offset from the page and page size', () => {
    expect(parseListQuery({ page: '3', pageSize: '20' }, SORTABLE).offset).toBe(40);
  });

  it('trims the search and caps its length', () => {
    expect(parseListQuery({ search: '  ada  ' }, SORTABLE).search).toBe('ada');
    expect(parseListQuery({ search: 'x'.repeat(500) }, SORTABLE).search).toHaveLength(MAX_SEARCH_LENGTH);
  });

  it('ignores a search that is not a string', () => {
    expect(parseListQuery({ search: ['a', 'b'] }, SORTABLE).search).toBe('');
  });

  it.each([
    ['page', '0'],
    ['page', '1.5'],
    ['page', 'abc'],
    ['pageSize', '0'],
    ['pageSize', String(MAX_PAGE_SIZE + 1)],
  ])('rejects %s=%s', (param, value) => {
    expect(errorCode(() => parseListQuery({ [param]: value }, SORTABLE))).toBe('VALIDATION_ERROR');
  });

  it('accepts the largest page size', () => {
    expect(parseListQuery({ pageSize: String(MAX_PAGE_SIZE) }, SORTABLE).pageSize).toBe(MAX_PAGE_SIZE);
  });

  it('only sorts by a column the list allows', () => {
    expect(parseListQuery({ sort: 'name' }, SORTABLE).sort).toBe('name');
    expect(errorCode(() => parseListQuery({ sort: 'password_hash' }, SORTABLE))).toBe('VALIDATION_ERROR');
  });

  it('does not accept inherited object keys as sort columns', () => {
    expect(errorCode(() => parseListQuery({ sort: 'toString' }, SORTABLE))).toBe('VALIDATION_ERROR');
  });

  it('only accepts asc or desc', () => {
    expect(parseListQuery({ dir: 'desc' }, SORTABLE).dir).toBe('desc');
    expect(errorCode(() => parseListQuery({ dir: 'DESC; DROP' }, SORTABLE))).toBe('VALIDATION_ERROR');
  });
});
