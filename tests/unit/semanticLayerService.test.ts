import { describe, expect, it } from 'vitest';
import { DATE_TYPES, NUMERIC_TYPES, STRING_TYPES } from '../../src/modules/queryEngine/queryConstants';
import {
  buildAggExpression,
  buildDateGroupExpression,
  buildNonEmptyCondition,
  buildWhereSql,
  formatPeriodDisplay,
  parsePeriodKey,
  resolveDateGrain,
  resolvedName,
  resolveSortDirection,
  validateAggregation,
} from '../../src/modules/queryEngine/semanticLayerService';

function column(name: string, typname: string, columnType: string = typname) {
  return {
    name,
    type: typname,
    isDate: DATE_TYPES.has(typname),
    isNumeric: NUMERIC_TYPES.has(typname),
    isString: STRING_TYPES.has(typname),
    isTemporal: DATE_TYPES.has(typname),
    columnType,
    nullable: true,
  };
}

const revenue = column('Revenue', 'numeric', 'numeric(12,2)');
const rating = column('AVG RATING', 'float8', 'double precision');
const seats = column('Seats Sold', 'int4', 'integer');
const genre = column('Genre', 'text');
const theater = column('Theater Name', 'varchar', 'character varying(120)');
const movie = column('Movie Name', 'text');
const showDate = column('Show Date', 'date');
const showTime = column('Show Time', 'timestamp', 'timestamp without time zone');
const premiere = column('Is Premiere', 'bool', 'boolean');

function filter(columnMeta: Record<string, any>, values: unknown, operator?: string) {
  return { column: columnMeta.name, operator, values, columnMeta };
}

describe('resolvedName', () => {
  it('returns the column name from the resolved metadata', () => {
    expect(resolvedName({ column: 'revenue', columnMeta: revenue })).toBe('Revenue');
  });

  it('refuses to render a node whose column was never resolved', () => {
    expect(() => resolvedName({ column: 'Revenue' })).toThrow(
      'Plan node for column "Revenue" has no resolved metadata; it cannot be rendered safely.'
    );
  });

  it('refuses a missing node', () => {
    expect(() => resolvedName(null)).toThrow(
      'Plan node for column "undefined" has no resolved metadata; it cannot be rendered safely.'
    );
  });
});

describe('resolveSortDirection', () => {
  it.each([undefined, null, '', '   '])('defaults %j to ASC', (input) => {
    expect(resolveSortDirection(input)).toBe('ASC');
  });

  it.each([
    ['asc', 'ASC'],
    ['ASC', 'ASC'],
    ['ascending', 'ASC'],
    ['desc', 'DESC'],
    ['Desc', 'DESC'],
    ['DESCENDING', 'DESC'],
    ['  desc  ', 'DESC'],
  ])('maps %j to %s', (input, expected) => {
    expect(resolveSortDirection(input)).toBe(expected);
  });

  it('rejects an unknown direction', () => {
    expect(() => resolveSortDirection('sideways')).toThrow(
      'Unsupported sort direction "sideways". Supported: ASC, ASCENDING, DESC, DESCENDING'
    );
  });

  it('rejects a direction carrying extra SQL instead of passing it through', () => {
    expect(() => resolveSortDirection('DESC; DROP TABLE cinema_analysis')).toThrow('Unsupported sort direction');
  });
});

describe('resolveDateGrain', () => {
  it.each([undefined, null, '', '  '])('defaults %j to MONTH', (input) => {
    expect(resolveDateGrain(input).key).toBe('MONTH');
  });

  it.each([
    ['HOUR', 'YYYY-MM-DD HH24":00"'],
    ['DAY', 'YYYY-MM-DD'],
    ['WEEK', 'IYYY"-W"IW'],
    ['MONTH', 'YYYY-MM'],
    ['YEAR', 'YYYY'],
  ])('resolves %s to the to_char format %s', (grain, format) => {
    const resolved = resolveDateGrain(grain);
    expect(resolved.key).toBe(grain);
    expect(resolved.format).toBe(format);
  });

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(resolveDateGrain(' week ').key).toBe('WEEK');
    expect(resolveDateGrain('Day').key).toBe('DAY');
  });

  it('rejects an unsupported grain', () => {
    expect(() => resolveDateGrain('QUARTER')).toThrow(
      'Unsupported date grain "QUARTER". Supported: HOUR, DAY, WEEK, MONTH, YEAR'
    );
  });
});

describe('validateAggregation', () => {
  it.each([
    ['SUM', 'SUM'],
    ['sum', 'SUM'],
    ['AVERAGE', 'AVG'],
    ['avg', 'AVG'],
    ['MEAN', 'AVG'],
    ['COUNT', 'COUNT'],
    ['COUNTDISTINCT', 'COUNT_DISTINCT'],
    ['count_distinct', 'COUNT_DISTINCT'],
    ['DISTINCT_COUNT', 'COUNT_DISTINCT'],
    ['MIN', 'MIN'],
    ['max', 'MAX'],
  ])('maps %s on a numeric column to %s', (input, expected) => {
    expect(validateAggregation(input, 'Revenue', revenue, 'cinema_analysis')).toBe(expected);
  });

  it.each([undefined, null, ''])('defaults %j to SUM', (input) => {
    expect(validateAggregation(input, 'Revenue', revenue)).toBe('SUM');
  });

  it('accepts SUM and AVG on integer and floating point columns', () => {
    expect(validateAggregation('SUM', 'Seats Sold', seats)).toBe('SUM');
    expect(validateAggregation('AVERAGE', 'AVG RATING', rating)).toBe('AVG');
  });

  it.each([
    ['text', genre],
    ['varchar', theater],
    ['date', showDate],
    ['unsupported', premiere],
  ])('allows COUNT and COUNT_DISTINCT on a %s column', (_label, meta) => {
    expect(validateAggregation('COUNT', meta.name, meta)).toBe('COUNT');
    expect(validateAggregation('COUNTDISTINCT', meta.name, meta)).toBe('COUNT_DISTINCT');
  });

  it.each([
    ['numeric', revenue],
    ['date', showDate],
    ['timestamp', showTime],
    ['text', genre],
  ])('allows MIN and MAX on a %s column', (_label, meta) => {
    expect(validateAggregation('MIN', meta.name, meta)).toBe('MIN');
    expect(validateAggregation('MAX', meta.name, meta)).toBe('MAX');
  });

  it('rejects SUM on a text column and names the table', () => {
    expect(() => validateAggregation('SUM', 'Genre', genre, 'cinema_analysis')).toThrow(
      'Aggregation "SUM" requires a numeric column, but "Genre" in table "cinema_analysis" is text (text). ' +
        'Use COUNT or COUNT_DISTINCT for non-numeric columns, or point the measure at a numeric column.'
    );
  });

  it('rejects AVG on a date column and leaves out the table when none is given', () => {
    expect(() => validateAggregation('AVERAGE', 'Show Date', showDate)).toThrow(
      'Aggregation "AVG" requires a numeric column, but "Show Date" is a date/time column (date). '
    );
  });

  it('rejects SUM when nothing is known about the column', () => {
    expect(() => validateAggregation('SUM', 'Ghost', null, 'cinema_analysis')).toThrow(
      'Aggregation "SUM" requires a numeric column, but "Ghost" in table "cinema_analysis" is of unknown type.'
    );
  });

  it('rejects MIN on a column type that cannot be ordered', () => {
    expect(() => validateAggregation('MIN', 'Is Premiere', premiere, 'cinema_analysis')).toThrow(
      'Aggregation "MIN" requires a numeric, date or text column, but "Is Premiere" in table "cinema_analysis" ' +
        'is of unsupported type (bool).'
    );
  });

  it('rejects an unknown aggregation and lists the supported ones', () => {
    expect(() => validateAggregation('MEDIAN', 'Revenue', revenue)).toThrow(
      'Unknown aggregation "MEDIAN". Supported: SUM, AVERAGE, AVG, MEAN, COUNT, COUNTDISTINCT, COUNT_DISTINCT, ' +
        'DISTINCT_COUNT, MIN, MAX'
    );
  });

  it('rejects an aggregation that smuggles in SQL', () => {
    expect(() => validateAggregation('SUM("Revenue")); DROP TABLE users; --', 'Revenue', revenue)).toThrow(
      'Unknown aggregation'
    );
  });
});

describe('buildAggExpression', () => {
  it('renders a plain aggregate without an alias', () => {
    expect(buildAggExpression('SUM', 'Revenue')).toBe('SUM("Revenue")');
  });

  it('renders an aliased aggregate using the SQL function for the alias given', () => {
    expect(buildAggExpression('AVERAGE', 'AVG RATING', '_value')).toBe('AVG("AVG RATING") AS "_value"');
  });

  it('renders a distinct count', () => {
    expect(buildAggExpression('COUNTDISTINCT', 'Booking Id', 'bookings')).toBe(
      'COUNT(DISTINCT "Booking Id") AS "bookings"'
    );
  });

  it('defaults to SUM when no aggregation is given', () => {
    expect(buildAggExpression(undefined, 'Revenue')).toBe('SUM("Revenue")');
  });

  it('escapes double quotes inside the column and the alias', () => {
    expect(buildAggExpression('MAX', 'Rev"enue', 'a"; DROP TABLE x; --')).toBe(
      'MAX("Rev""enue") AS "a""; DROP TABLE x; --"'
    );
  });

  it('rejects an unknown aggregation', () => {
    expect(() => buildAggExpression('STDDEV', 'Revenue')).toThrow('Unknown aggregation "STDDEV"');
  });
});

describe('buildDateGroupExpression', () => {
  it('formats a native date column with the grain format', () => {
    expect(buildDateGroupExpression('Show Date', 'DAY', { isString: false })).toBe(
      `to_char("Show Date", 'YYYY-MM-DD')`
    );
  });

  it('defaults to a monthly bucket when no grain or options are given', () => {
    expect(buildDateGroupExpression('Show Date', undefined)).toBe(`to_char("Show Date", 'YYYY-MM')`);
  });

  it('renders hour and week buckets with their literal separators', () => {
    expect(buildDateGroupExpression('Show Time', 'HOUR')).toBe(`to_char("Show Time", 'YYYY-MM-DD HH24":00"')`);
    expect(buildDateGroupExpression('Show Date', 'week')).toBe(`to_char("Show Date", 'IYYY"-W"IW')`);
  });

  it('parses a text date column with its declared parse format first', () => {
    expect(buildDateGroupExpression('Booking Date', 'MONTH', { isString: true, parseFormat: 'DD-Mon-YY' })).toBe(
      `to_char(to_date("Booking Date", 'DD-Mon-YY'), 'YYYY-MM')`
    );
  });

  it('escapes single quotes in the parse format so it stays a single literal', () => {
    expect(
      buildDateGroupExpression('Booking Date', 'YEAR', { isString: true, parseFormat: "DD-Mon-YY'); DROP TABLE x; --" })
    ).toBe(`to_char(to_date("Booking Date", 'DD-Mon-YY''); DROP TABLE x; --'), 'YYYY')`);
  });

  it('escapes double quotes in the column name', () => {
    expect(buildDateGroupExpression('Show"Date', 'YEAR')).toBe(`to_char("Show""Date", 'YYYY')`);
  });

  it('requires a parse format for a text date column', () => {
    expect(() => buildDateGroupExpression('Booking Date', 'MONTH', { isString: true })).toThrow(
      'Date column "Booking Date" has a string type. Provide its parse format in dataSource.dateParse ' +
        '(e.g. {"Booking Date": "DD-Mon-YY"}) or use a native DATE/TIMESTAMP column.'
    );
  });

  it('rejects a strftime pattern used as a parse format', () => {
    expect(() =>
      buildDateGroupExpression('Booking Date', 'MONTH', { isString: true, parseFormat: '%d-%b-%y' })
    ).toThrow(
      'dateParse for "Booking Date" uses the pattern "%d-%b-%y", which is not a to_date template. ' +
        'Use one instead, e.g. "DD-Mon-YY" for 15-Aug-23, "YYYY-MM-DD" for 2023-08-15.'
    );
  });

  it('rejects an unsupported grain', () => {
    expect(() => buildDateGroupExpression('Show Date', 'QUARTER')).toThrow('Unsupported date grain "QUARTER"');
  });
});

describe('buildNonEmptyCondition', () => {
  it('only excludes NULL for a non-text column', () => {
    expect(buildNonEmptyCondition('Revenue', revenue)).toBe('"Revenue" IS NOT NULL');
  });

  it('also excludes empty strings for a text column', () => {
    expect(buildNonEmptyCondition('Theater Name', theater)).toBe(`"Theater Name" IS NOT NULL AND "Theater Name" <> ''`);
  });

  it('only excludes NULL when the column metadata is missing', () => {
    expect(buildNonEmptyCondition('Genre', undefined)).toBe('"Genre" IS NOT NULL');
  });
});

describe('buildWhereSql', () => {
  it.each([undefined, null, []])('returns no clause for %j', (input) => {
    expect(buildWhereSql(input)).toEqual({ where: '', params: [] });
  });

  it('renders an IN filter on a text column with one placeholder per value', () => {
    expect(buildWhereSql([filter(genre, ['Drama', 'Comedy'], 'IN')])).toEqual({
      where: ' WHERE "Genre" IN (?, ?)',
      params: ['Drama', 'Comedy'],
    });
  });

  it('treats a filter without an operator as IN', () => {
    expect(buildWhereSql([filter(genre, ['Drama'])])).toEqual({ where: ' WHERE "Genre" IN (?)', params: ['Drama'] });
  });

  it('compares a non-text column as text for IN and stringifies the values', () => {
    expect(buildWhereSql([filter(seats, [120, 80], 'in')])).toEqual({
      where: ' WHERE "Seats Sold"::text IN (?, ?)',
      params: ['120', '80'],
    });
  });

  it('joins several filters with AND and keeps params in clause order', () => {
    expect(buildWhereSql([filter(genre, ['Drama']), filter(theater, ['Regal', 'AMC'])])).toEqual({
      where: ' WHERE "Genre" IN (?) AND "Theater Name" IN (?, ?)',
      params: ['Drama', 'Regal', 'AMC'],
    });
  });

  it('skips IN filters with no values or with values that are not a list', () => {
    expect(buildWhereSql([filter(genre, []), filter(theater, 'Regal'), filter(movie, null)])).toEqual({
      where: '',
      params: [],
    });
  });

  it.each([
    ['EQ', '='],
    ['equals', '='],
    ['=', '='],
    ['NE', '!='],
    ['neq', '!='],
    ['!=', '!='],
    ['GT', '>'],
    ['>', '>'],
    ['gte', '>='],
    ['>=', '>='],
    ['LT', '<'],
    ['<', '<'],
    ['lte', '<='],
    ['<=', '<='],
    ['like', 'LIKE'],
  ])('renders operator %s as %s with a single parameter', (operator, sql) => {
    expect(buildWhereSql([filter(genre, ['Drama', 'Comedy'], operator)])).toEqual({
      where: ` WHERE "Genre" ${sql} ?`,
      params: ['Drama'],
    });
  });

  it('skips a single-value operator with no values', () => {
    expect(buildWhereSql([filter(genre, [], 'EQ')])).toEqual({ where: '', params: [] });
  });

  it('renders BETWEEN with two parameters and ignores extra values', () => {
    expect(buildWhereSql([filter(movie, ['A', 'M', 'Z'], 'between')])).toEqual({
      where: ' WHERE "Movie Name" BETWEEN ? AND ?',
      params: ['A', 'M'],
    });
  });

  it('skips BETWEEN with fewer than two values', () => {
    expect(buildWhereSql([filter(movie, ['A'], 'BETWEEN')])).toEqual({ where: '', params: [] });
  });

  it('rejects an unsupported operator', () => {
    expect(() => buildWhereSql([filter(genre, ['x'], 'REGEXP')])).toThrow(
      'Unsupported filter operator "REGEXP". Supported: IN, EQ, EQUALS, =, NE, NEQ, !=, GT, >, GTE, >=, LT, <, LTE, ' +
        '<=, LIKE, BETWEEN'
    );
  });

  it('rejects an operator that carries SQL', () => {
    expect(() => buildWhereSql([filter(genre, ['x'], 'IN (SELECT 1) OR 1=1 --')])).toThrow(
      'Unsupported filter operator'
    );
  });

  it('refuses a filter whose column was never resolved', () => {
    expect(() => buildWhereSql([{ column: 'Genre', operator: 'IN', values: ['Drama'] }])).toThrow(
      'Plan node for column "Genre" has no resolved metadata; it cannot be rendered safely.'
    );
  });

  it('renders the resolved column name, not the raw spec column', () => {
    expect(
      buildWhereSql([{ column: 'genre" OR 1=1 --', operator: 'IN', values: ['Drama'], columnMeta: genre }])
    ).toEqual({ where: ' WHERE "Genre" IN (?)', params: ['Drama'] });
  });

  it('escapes double quotes in a resolved column name', () => {
    const odd = column('Genre" OR 1=1 --', 'text');
    expect(buildWhereSql([filter(odd, ['Drama'])])).toEqual({
      where: ' WHERE "Genre"" OR 1=1 --" IN (?)',
      params: ['Drama'],
    });
  });

  it('keeps hostile values out of the SQL text and passes them as parameters', () => {
    const hostile = ["Drama' OR '1'='1", 'x"; DROP TABLE users; --', '?', "'); DELETE FROM cinema_analysis; --"];
    const { where, params } = buildWhereSql([filter(genre, hostile)]);
    expect(where).toBe(' WHERE "Genre" IN (?, ?, ?, ?)');
    expect(params).toEqual(hostile);
    for (const value of hostile) {
      if (value !== '?') expect(where).not.toContain(value);
    }
  });

  it('compares number and date columns as their own type, not as text', () => {
    expect(buildWhereSql([filter(revenue, ['9', '100'], 'BETWEEN')])).toEqual({
      where: ' WHERE "Revenue" BETWEEN ? AND ?',
      params: ['9', '100'],
    });
    expect(buildWhereSql([filter(showDate, ['2026-01-01'], 'GTE')])).toEqual({
      where: ' WHERE "Show Date" >= ?',
      params: ['2026-01-01'],
    });
  });

  it('refuses a comparison on a number column with a value that is not a number', () => {
    expect(() => buildWhereSql([filter(revenue, ['lots'], 'GT')])).toThrow(
      'Filter on "Revenue" needs numeric values: it is a number column.'
    );
    expect(() => buildWhereSql([filter(seats, ['', '10'], 'BETWEEN')])).toThrow('needs numeric values');
  });
});

describe('parsePeriodKey', () => {
  it.each([undefined, null, ''])('returns 0 for %j', (input) => {
    expect(parsePeriodKey(input)).toBe(0);
  });

  it.each([
    ['2024', 2024],
    ['2024-03', 202403],
    ['2024-3', 202403],
    ['2024-W07', 202407],
    ['2024-W7', 202407],
    ['2024-03-05', Date.UTC(2024, 2, 5)],
    ['2024-03-05 14:00', Date.UTC(2024, 2, 5, 14, 0)],
    ['2024-03-05T14:00', Date.UTC(2024, 2, 5, 14, 0)],
  ])('infers the grain of %s and returns %d', (period, expected) => {
    expect(parsePeriodKey(period)).toBe(expected);
  });

  it('uses an explicit grain when the period matches it', () => {
    expect(parsePeriodKey('2024-03', 'month')).toBe(202403);
    expect(parsePeriodKey('2024', 'YEAR')).toBe(2024);
  });

  it('ignores an unknown grain and infers from the period instead', () => {
    expect(parsePeriodKey('2024-03', 'QUARTER')).toBe(202403);
  });

  it('falls back to Date.parse for timestamps that match no grain', () => {
    expect(parsePeriodKey('2024-03-05T10:20:30Z')).toBe(Date.UTC(2024, 2, 5, 10, 20, 30));
  });

  it('returns 0 for text that is not a date', () => {
    expect(parsePeriodKey('not a period')).toBe(0);
  });

  it('orders single and double digit months chronologically', () => {
    const periods = ['2024-01', '2023-10', '2023-9', '2023-12'];
    const sorted = [...periods].sort((a, b) => parsePeriodKey(a, 'MONTH') - parsePeriodKey(b, 'MONTH'));
    expect(sorted).toEqual(['2023-9', '2023-10', '2023-12', '2024-01']);
  });

  it('orders ISO weeks across a year boundary', () => {
    const periods = ['2025-W01', '2024-W52', '2024-W9'];
    const sorted = [...periods].sort((a, b) => parsePeriodKey(a, 'WEEK') - parsePeriodKey(b, 'WEEK'));
    expect(sorted).toEqual(['2024-W9', '2024-W52', '2025-W01']);
  });
});

describe('formatPeriodDisplay', () => {
  it.each([undefined, null, ''])('returns an empty label for %j', (input) => {
    expect(formatPeriodDisplay(input)).toBe('');
  });

  it.each([
    ['2024', '2024'],
    ['2024-03', 'Mar 2024'],
    ['2024-3', 'Mar 2024'],
    ['2024-W7', 'W07 2024'],
    ['2024-03-05', 'Mar 5, 2024'],
    ['2024-12-25 09:00', 'Dec 25, 2024 09:00'],
    ['2024-3-5 9:30', 'Mar 5, 2024 09:30'],
  ])('labels %s as %s', (period, label) => {
    expect(formatPeriodDisplay(period)).toBe(label);
  });

  it('labels a numeric year', () => {
    expect(formatPeriodDisplay(2024)).toBe('2024');
  });

  it('uses an explicit grain', () => {
    expect(formatPeriodDisplay('2024-01', 'MONTH')).toBe('Jan 2024');
    expect(formatPeriodDisplay('2024-01-31', 'day')).toBe('Jan 31, 2024');
  });

  it('returns the raw period when it does not match the explicit grain', () => {
    expect(formatPeriodDisplay('2024-03-05', 'MONTH')).toBe('2024-03-05');
  });

  it('returns the raw period when the month is out of range', () => {
    expect(formatPeriodDisplay('2024-13')).toBe('2024-13');
    expect(formatPeriodDisplay('2024-00-10')).toBe('2024-00-10');
  });

  it('returns the raw period when no grain matches', () => {
    expect(formatPeriodDisplay('Q1 2024')).toBe('Q1 2024');
  });
});
