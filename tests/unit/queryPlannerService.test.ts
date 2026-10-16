import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DATE_TYPES, NUMERIC_TYPES, STRING_TYPES } from '../../src/constants/query';
import { resolveColumn } from '../../src/services/metadataService';
import {
  buildFilters,
  kpiValueColumn,
  planCard,
  planKpi,
  planSlicer,
  readKpiPeriod,
} from '../../src/services/queryPlannerService';

vi.mock('../../src/services/metadataService', () => ({
  resolveColumn: vi.fn((table: any, name: string) => {
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new Error('Invalid column name: empty or non-string');
    }
    const found = table.columnMap.get(name) || table.byLower.get(name.toLowerCase());
    if (!found) {
      throw new Error(`Unknown column "${name}" in table "${table.table}"`);
    }
    return found;
  }),
  resolveSourceMetadata: vi.fn(),
}));

const SOURCE = { database: 'elze', schema: 'public', table: 'cinema_analysis' };

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

const COLUMNS = [
  column('Booking Id', 'text'),
  column('Booking Date', 'text'),
  column('Show Date', 'date'),
  column('Genre', 'text'),
  column('Theater Name', 'varchar', 'character varying(120)'),
  column('Movie Name', 'text'),
  column('Revenue', 'numeric', 'numeric(12,2)'),
  column('Budget', 'numeric', 'numeric(12,2)'),
  column('AVG RATING', 'float8', 'double precision'),
  column('Seats Sold', 'int4', 'integer'),
  column('Is Premiere', 'bool', 'boolean'),
];

function buildMeta(dateParse: Record<string, string> = { 'Booking Date': 'DD-Mon-YY' }) {
  const columnMap = new Map(COLUMNS.map((c) => [c.name, c]));
  const byLower = new Map(COLUMNS.map((c) => [c.name.toLowerCase(), c]));
  return {
    source: { ...SOURCE },
    table: { ...SOURCE, columns: COLUMNS, columnMap, byLower },
    columns: columnMap,
    dateParse,
  };
}

const meta = buildMeta();

function col(name: string) {
  return meta.table.columnMap.get(name);
}

const SLICERS = [
  { id: 'sGenre', title: 'Genre', column: 'Genre', type: 'multi' },
  { id: 'sTheater', title: 'Theater', column: 'Theater Name', type: 'multi' },
  { id: 'sStatus', title: 'Status', column: 'Ghost Status', type: 'single' },
];

const totalRevenueKpi = {
  id: 'totalRevenue',
  chartType: 'badge_multi_value',
  title: 'Total Revenue USD',
  columns: [{ column: 'Revenue', mapping: 'VALUE', aggregation: 'SUM', format: { type: 'abbreviated' } }],
  dateGrain: { column: 'Booking Date', dateTimeElement: 'MONTH' },
  comparison: { label: 'vs last month' },
};

const revenueByMovie = {
  id: 'revenueByMovie',
  chartType: 'line_bar_combo',
  title: 'Revenue vs Profit by Movie',
  columns: [
    { column: 'Movie Name', mapping: 'XTIME' },
    { column: 'Budget', mapping: 'VALUE', aggregation: 'SUM' },
  ],
  groupBy: [{ column: 'Movie Name' }],
  limits: 5,
};

const genreFilter = [{ column: 'Genre', operator: 'IN', values: ['Drama'], columnMeta: col('Genre') }];

beforeEach(() => {
  vi.mocked(resolveColumn).mockClear();
});

describe('buildFilters', () => {
  it.each([undefined, null])('returns no filters when the request has %j', (filters) => {
    expect(buildFilters({ slicers: SLICERS }, filters, meta)).toEqual([]);
  });

  it('turns each selected slicer into an IN filter on its resolved column', () => {
    expect(buildFilters({ slicers: SLICERS }, { sGenre: ['Drama', 'Comedy'], sTheater: ['Regal'] }, meta)).toEqual([
      { column: 'Genre', operator: 'IN', values: ['Drama', 'Comedy'], columnMeta: col('Genre') },
      { column: 'Theater Name', operator: 'IN', values: ['Regal'], columnMeta: col('Theater Name') },
    ]);
    expect(resolveColumn).toHaveBeenCalledWith(meta.table, 'Genre');
    expect(resolveColumn).toHaveBeenCalledWith(meta.table, 'Theater Name');
  });

  it('follows slicer order, not request key order', () => {
    const result = buildFilters({ slicers: SLICERS }, { sTheater: ['AMC'], sGenre: ['Action'] }, meta);
    expect(result.map((f) => f.column)).toEqual(['Genre', 'Theater Name']);
  });

  it('ignores empty selections and keys that do not belong to a slicer', () => {
    expect(
      buildFilters({ slicers: SLICERS }, { sGenre: [], sTheater: null, '"Genre" OR 1=1': ['x'], Revenue: ['1'] }, meta)
    ).toEqual([]);
  });

  it('does not resolve the column of a slicer that has no selection', () => {
    expect(buildFilters({ slicers: SLICERS }, { sGenre: ['Drama'] }, meta)).toHaveLength(1);
    expect(resolveColumn).toHaveBeenCalledTimes(1);
  });

  it('accepts a single value as a one-item selection', () => {
    expect(buildFilters({ slicers: SLICERS }, { sGenre: 'Drama' }, meta)).toEqual([
      { column: 'Genre', operator: 'IN', values: ['Drama'], columnMeta: col('Genre') },
    ]);
  });

  it.each([[{ $ne: null }], [['Drama', { $ne: null }]], [[null]]])('refuses the selection %j', (selection) => {
    expect(() => buildFilters({ slicers: SLICERS }, { sGenre: selection }, meta)).toThrow(
      'The selection for slicer "sGenre" must be a value or a list of values.'
    );
  });

  it('returns no filters when the spec has no slicers', () => {
    expect(buildFilters({}, { sGenre: ['Drama'] }, meta)).toEqual([]);
  });

  it('stringifies non-string selections', () => {
    const [filter] = buildFilters({ slicers: SLICERS }, { sGenre: [2024, true, 0] }, meta);
    expect(filter.values).toEqual(['2024', 'true', '0']);
  });

  it('keeps hostile selections verbatim as data values', () => {
    const hostile = ["Drama' OR '1'='1", '"; DROP TABLE cinema_analysis; --'];
    const [filter] = buildFilters({ slicers: SLICERS }, { sGenre: hostile }, meta);
    expect(filter.values).toEqual(hostile);
    expect(filter.columnMeta).toBe(col('Genre'));
  });

  it('rejects a selected slicer whose column is not in the table', () => {
    expect(() => buildFilters({ slicers: SLICERS }, { sStatus: ['Booked'] }, meta)).toThrow(
      'Unknown column "Ghost Status" in table "cinema_analysis"'
    );
  });
});

describe('kpiValueColumn', () => {
  it('picks the column mapped to VALUE', () => {
    const value = { column: 'Revenue', mapping: 'VALUE' };
    expect(kpiValueColumn({ columns: [{ column: 'Genre', mapping: 'SERIES' }, value] })).toBe(value);
  });

  it('falls back to the first column when none is mapped to VALUE', () => {
    const first = { column: 'Revenue' };
    expect(kpiValueColumn({ columns: [first, { column: 'Budget' }] })).toBe(first);
  });

  it('reads columns from series.main when the card has none of its own', () => {
    const value = { column: 'Revenue', mapping: 'VALUE' };
    expect(kpiValueColumn({ series: { main: { columns: [value] } } })).toBe(value);
  });

  it('returns null when the card has no columns', () => {
    expect(kpiValueColumn({ id: 'empty' })).toBeNull();
    expect(kpiValueColumn({ columns: [] })).toBeNull();
  });
});

describe('readKpiPeriod', () => {
  it('reads the comparison date grain', () => {
    expect(readKpiPeriod(totalRevenueKpi)).toEqual({ column: 'Booking Date', grain: 'MONTH' });
  });

  it('returns null without a comparison even when a date grain exists', () => {
    expect(readKpiPeriod({ dateGrain: { column: 'Booking Date', dateTimeElement: 'MONTH' } })).toBeNull();
  });

  it.each([undefined, null])('returns null for a %j card', (kpi) => {
    expect(readKpiPeriod(kpi)).toBeNull();
  });

  it.each([
    [{ column: 'Show Date', grain: 'DAY' }, 'DAY'],
    [{ column: 'Show Date', element: 'WEEK' }, 'WEEK'],
    [{ column: 'Show Date', dateTimeElement: 'YEAR', grain: 'DAY' }, 'YEAR'],
  ])('accepts the grain key used in %j', (dateGrain, grain) => {
    expect(readKpiPeriod({ comparison: {}, dateGrain })).toEqual({ column: 'Show Date', grain });
  });

  it('falls back to the date grain on series.main', () => {
    expect(
      readKpiPeriod({
        comparison: {},
        series: { main: { dateGrain: { column: 'Show Date', dateTimeElement: 'DAY' } } },
      })
    ).toEqual({ column: 'Show Date', grain: 'DAY' });
  });

  it('prefers the card date grain over series.main', () => {
    expect(
      readKpiPeriod({
        comparison: {},
        dateGrain: { column: 'Booking Date', dateTimeElement: 'MONTH' },
        series: { main: { dateGrain: { column: 'Show Date', dateTimeElement: 'DAY' } } },
      })
    ).toEqual({ column: 'Booking Date', grain: 'MONTH' });
  });

  it.each([[{ dateTimeElement: 'MONTH' }], [{ column: 'Show Date' }], ['MONTH'], [null]])(
    'returns null for an incomplete date grain %j',
    (dateGrain) => {
      expect(readKpiPeriod({ comparison: {}, dateGrain })).toBeNull();
    }
  );
});

describe('planKpi', () => {
  it('plans a KPI without a comparison as a single aggregate', () => {
    const kpi = { id: 'totalRevenue', chartType: 'badge_multi_value', columns: totalRevenueKpi.columns };
    expect(planKpi(kpi, genreFilter, meta, 2)).toEqual({
      kind: 'kpi-simple',
      id: 'totalRevenue',
      specIndex: 2,
      kpi,
      source: SOURCE,
      measures: [{ column: 'Revenue', aggregation: 'SUM', alias: '_value', columnMeta: col('Revenue') }],
      dateGroup: null,
      orderBy: [],
      filters: genreFilter,
      limit: null,
    });
  });

  it('plans a KPI with a comparison as a period series using the declared parse format', () => {
    expect(planKpi(totalRevenueKpi, [], meta, 0)).toEqual({
      kind: 'kpi-period',
      id: 'totalRevenue',
      specIndex: 0,
      kpi: totalRevenueKpi,
      source: SOURCE,
      measures: [{ column: 'Revenue', aggregation: 'SUM', alias: '_value', columnMeta: col('Revenue') }],
      dateGroup: {
        column: 'Booking Date',
        grain: 'MONTH',
        isString: true,
        parseFormat: 'DD-Mon-YY',
        columnMeta: col('Booking Date'),
      },
      orderBy: [],
      filters: [],
      limit: null,
    });
  });

  it('builds a native date group without a parse format and normalises the grain', () => {
    const kpi = {
      id: 'bookings',
      columns: [{ column: 'Booking Id', mapping: 'VALUE', aggregation: 'COUNTDISTINCT' }],
      dateGrain: { column: 'Show Date', dateTimeElement: 'week' },
      comparison: {},
    };
    const plan = planKpi(kpi, [], meta, 1);
    expect(plan.dateGroup).toEqual({
      column: 'Show Date',
      grain: 'WEEK',
      isString: false,
      parseFormat: null,
      columnMeta: col('Show Date'),
    });
    expect(plan.measures[0].aggregation).toBe('COUNT_DISTINCT');
  });

  it('passes the filter list through by reference', () => {
    expect(planKpi(totalRevenueKpi, genreFilter, meta, 0).filters).toBe(genreFilter);
  });

  it('maps aggregation aliases to their SQL function', () => {
    const kpi = { id: 'avgRating', columns: [{ column: 'AVG RATING', mapping: 'VALUE', aggregation: 'AVERAGE' }] };
    expect(planKpi(kpi, [], meta, 0).measures[0].aggregation).toBe('AVG');
  });

  it('defaults the aggregation to SUM', () => {
    const kpi = { id: 'seats', columns: [{ column: 'Seats Sold', mapping: 'VALUE' }] };
    expect(planKpi(kpi, [], meta, 0).measures[0].aggregation).toBe('SUM');
  });

  it('resolves the value column case-insensitively but keeps the spec name', () => {
    const kpi = { id: 'rev', columns: [{ column: 'revenue', mapping: 'VALUE' }] };
    const [measure] = planKpi(kpi, [], meta, 0).measures;
    expect(measure.column).toBe('revenue');
    expect(measure.columnMeta).toBe(col('Revenue'));
  });

  it('reads the value column from series.main', () => {
    const kpi = { id: 'rev', series: { main: { columns: [{ column: 'Budget', mapping: 'VALUE' }] } } };
    expect(planKpi(kpi, [], meta, 0).measures[0].columnMeta).toBe(col('Budget'));
  });

  it('rejects a KPI without a value column', () => {
    expect(() => planKpi({ id: 'empty', columns: [] }, [], meta, 0)).toThrow(
      'KPI card has no value column: add a field with the "Value" role.'
    );
  });

  it('rejects a value column that is not in the table', () => {
    const kpi = { id: 'profit', columns: [{ column: 'Profit', mapping: 'VALUE' }] };
    expect(() => planKpi(kpi, [], meta, 0)).toThrow('Unknown column "Profit" in table "cinema_analysis"');
  });

  it('rejects SUM over a text column', () => {
    const kpi = { id: 'genres', columns: [{ column: 'Genre', mapping: 'VALUE', aggregation: 'SUM' }] };
    expect(() => planKpi(kpi, [], meta, 0)).toThrow(
      'Aggregation "SUM" requires a numeric column, but "Genre" in table "cinema_analysis" is text (text).'
    );
  });

  it('rejects an unknown aggregation', () => {
    const kpi = { id: 'median', columns: [{ column: 'Revenue', mapping: 'VALUE', aggregation: 'MEDIAN' }] };
    expect(() => planKpi(kpi, [], meta, 0)).toThrow('Unknown aggregation "MEDIAN"');
  });

  it('rejects an unsupported comparison grain', () => {
    const kpi = { ...totalRevenueKpi, dateGrain: { column: 'Booking Date', dateTimeElement: 'QUARTER' } };
    expect(() => planKpi(kpi, [], meta, 0)).toThrow('Unsupported date grain "QUARTER"');
  });

  it('rejects a comparison date column that is not in the table', () => {
    const kpi = { ...totalRevenueKpi, dateGrain: { column: 'Release Date', dateTimeElement: 'MONTH' } };
    expect(() => planKpi(kpi, [], meta, 0)).toThrow('Unknown column "Release Date" in table "cinema_analysis"');
  });
});

describe('planCard', () => {
  it('plans a grouped chart with its measure, dimension and limit', () => {
    expect(planCard(revenueByMovie, genreFilter, meta, 4)).toEqual({
      kind: 'card',
      id: 'revenueByMovie',
      specIndex: 4,
      card: revenueByMovie,
      chartType: 'line_bar_combo',
      source: SOURCE,
      measures: [{ column: 'Budget', aggregation: 'SUM', alias: 'Budget', columnMeta: col('Budget') }],
      dimensions: [{ column: 'Movie Name', columnMeta: col('Movie Name') }],
      dateGroup: null,
      orderBy: [],
      limit: 5,
      filters: genreFilter,
    });
  });

  it.each(['XTIME', 'SERIES', 'ITEM'])('groups by the first %s column when groupBy is absent', (mapping) => {
    const card = {
      id: 'c',
      columns: [
        { column: 'Revenue', mapping: 'VALUE' },
        { column: 'Genre', mapping },
        { column: 'Movie Name', mapping },
      ],
    };
    expect(planCard(card, [], meta, 0).dimensions).toEqual([{ column: 'Genre', columnMeta: col('Genre') }]);
  });

  it('uses only the groupBy list when present and skips entries without a column', () => {
    const card = {
      id: 'revenueByGenre',
      columns: [
        { column: 'Movie Name', mapping: 'XTIME' },
        { column: 'Revenue', aggregation: 'SUM', mapping: 'VALUE' },
        { column: 'Genre', mapping: 'SERIES' },
      ],
      groupBy: [{ column: 'Theater Name' }, {}, { column: 'Genre' }],
    };
    expect(planCard(card, [], meta, 0).dimensions).toEqual([
      { column: 'Theater Name', columnMeta: col('Theater Name') },
      { column: 'Genre', columnMeta: col('Genre') },
    ]);
  });

  it('plans one measure per VALUE column aliased by its spec name', () => {
    const card = {
      id: 'c',
      columns: [
        { column: 'Genre', mapping: 'SERIES' },
        { column: 'revenue', mapping: 'VALUE', aggregation: 'sum' },
        { column: 'Booking Id', mapping: 'VALUE', aggregation: 'COUNT' },
        { column: 'AVG RATING', mapping: 'TOOLTIP' },
      ],
    };
    expect(planCard(card, [], meta, 0).measures).toEqual([
      { column: 'revenue', aggregation: 'SUM', alias: 'revenue', columnMeta: col('Revenue') },
      { column: 'Booking Id', aggregation: 'COUNT', alias: 'Booking Id', columnMeta: col('Booking Id') },
    ]);
  });

  it('plans a card without columns as an empty selection', () => {
    const plan = planCard({ id: 'blank' }, [], meta, 0);
    expect(plan.measures).toEqual([]);
    expect(plan.dimensions).toEqual([]);
    expect(plan.dateGroup).toBeNull();
    expect(plan.limit).toBeNull();
  });

  it('turns the date grain column into a date group and drops it from the dimensions', () => {
    const card = {
      id: 'trend',
      columns: [
        { column: 'BOOKING DATE', mapping: 'XTIME' },
        { column: 'Revenue', mapping: 'VALUE' },
      ],
      dateGrain: { column: 'Booking Date', dateTimeElement: 'DAY' },
    };
    const plan = planCard(card, [], meta, 0);
    expect(plan.dimensions).toEqual([]);
    expect(plan.dateGroup).toEqual({
      column: 'Booking Date',
      grain: 'DAY',
      isString: true,
      parseFormat: 'DD-Mon-YY',
      columnMeta: col('Booking Date'),
    });
  });

  it('keeps other groupBy dimensions alongside the date group', () => {
    const card = {
      id: 'trend',
      columns: [{ column: 'Revenue', mapping: 'VALUE' }],
      groupBy: [{ column: 'Show Date' }, { column: 'Genre' }],
      dateGrain: { column: 'Show Date', dateTimeElement: 'MONTH' },
    };
    const plan = planCard(card, [], meta, 0);
    expect(plan.dateGroup.column).toBe('Show Date');
    expect(plan.dimensions).toEqual([{ column: 'Genre', columnMeta: col('Genre') }]);
  });

  it('reads columns and the date grain from series.main', () => {
    const card = {
      id: 'legacy',
      series: {
        main: {
          columns: [
            { column: 'Show Date', mapping: 'XTIME' },
            { column: 'Seats Sold', mapping: 'VALUE' },
          ],
          dateGrain: { column: 'Show Date', grain: 'YEAR' },
        },
      },
    };
    const plan = planCard(card, [], meta, 0);
    expect(plan.dateGroup.grain).toBe('YEAR');
    expect(plan.measures[0].columnMeta).toBe(col('Seats Sold'));
    expect(plan.dimensions).toEqual([]);
  });

  it.each([
    [5, 5],
    ['10', 10],
    ['all', null],
    ['', null],
    [undefined, null],
    [0, null],
  ])('parses limits %j as %j', (limits, expected) => {
    expect(planCard({ ...revenueByMovie, limits }, [], meta, 0).limit).toBe(expected);
  });

  it.each(['5; DROP TABLE cinema_analysis', '12 rows', '-5', '2.5'])('rejects limits %j', (limits) => {
    expect(() => planCard({ ...revenueByMovie, limits }, [], meta, 0)).toThrow(
      `Card "limits" must be a whole number of rows, 0 or "all" for no limit (got "${limits}").`
    );
  });

  it('finds the date parse format whatever the case of the column name', () => {
    const card = {
      id: 'byMonth',
      columns: [{ column: 'Revenue', mapping: 'VALUE' }],
      dateGrain: { column: 'booking date', dateTimeElement: 'MONTH' },
    };
    expect(planCard(card, [], meta, 0).dateGroup.parseFormat).toBe('DD-Mon-YY');
  });

  it('refuses a column that is both a group and a value', () => {
    const card = {
      id: 'countByGenre',
      columns: [
        { column: 'Genre', mapping: 'SERIES' },
        { column: 'genre', mapping: 'VALUE', aggregation: 'COUNT' },
      ],
      groupBy: [{ column: 'Genre' }],
    };
    expect(() => planCard(card, [], meta, 0)).toThrow('"genre" is both a group and a value in this card');
  });

  it('rejects a dimension that is not in the table', () => {
    const card = { ...revenueByMovie, groupBy: [{ column: 'Director' }] };
    expect(() => planCard(card, [], meta, 0)).toThrow('Unknown column "Director" in table "cinema_analysis"');
  });

  it('rejects AVG over a text measure', () => {
    const card = { id: 'c', columns: [{ column: 'Movie Name', mapping: 'VALUE', aggregation: 'AVG' }] };
    expect(() => planCard(card, [], meta, 0)).toThrow(
      'Aggregation "AVG" requires a numeric column, but "Movie Name" in table "cinema_analysis" is text (text).'
    );
  });

  it('rejects an unsupported date grain', () => {
    const card = { ...revenueByMovie, dateGrain: { column: 'Show Date', dateTimeElement: 'FORTNIGHT' } };
    expect(() => planCard(card, [], meta, 0)).toThrow('Unsupported date grain "FORTNIGHT"');
  });

  describe('orderBy', () => {
    const grouped = {
      id: 'byGenre',
      columns: [
        { column: 'Genre', mapping: 'SERIES' },
        { column: 'Revenue', mapping: 'VALUE', aggregation: 'SUM' },
      ],
      groupBy: [{ column: 'Genre' }],
    };

    it('orders by a measure using the measure aggregation and defaults to ASC', () => {
      expect(planCard({ ...grouped, orderBy: 'Revenue' }, [], meta, 0).orderBy).toEqual([
        { column: 'Revenue', direction: 'ASC', columnMeta: col('Revenue'), aggregation: 'SUM' },
      ]);
    });

    it('orders by a dimension without an aggregation', () => {
      expect(planCard({ ...grouped, orderBy: [{ column: 'genre', direction: 'desc' }] }, [], meta, 0).orderBy).toEqual([
        { column: 'genre', direction: 'DESC', columnMeta: col('Genre'), aggregation: null },
      ]);
    });

    it('orders by an unselected column when it names an aggregation', () => {
      expect(
        planCard(
          { ...grouped, orderBy: [{ column: 'Seats Sold', aggregation: 'max', dir: 'DESCENDING' }] },
          [],
          meta,
          0
        ).orderBy
      ).toEqual([{ column: 'Seats Sold', direction: 'DESC', columnMeta: col('Seats Sold'), aggregation: 'MAX' }]);
    });

    it('refuses to order a card that only has measures by a raw column', () => {
      const totals = {
        id: 'totals',
        columns: [{ column: 'Revenue', mapping: 'VALUE', aggregation: 'SUM' }],
        orderBy: 'Genre',
      };
      expect(() => planCard(totals, [], meta, 0)).toThrow(
        `orderBy column "Genre" must be one of the card's groupBy dimensions or measures`
      );
    });

    it('lets an explicit aggregation override the measure aggregation', () => {
      expect(planCard({ ...grouped, orderBy: [{ column: 'Revenue', agg: 'AVG' }] }, [], meta, 0).orderBy).toEqual([
        { column: 'Revenue', direction: 'ASC', columnMeta: col('Revenue'), aggregation: 'AVG' },
      ]);
    });

    it('orders by the date group when the column matches it', () => {
      const card = {
        id: 'trend',
        columns: [{ column: 'Revenue', mapping: 'VALUE' }],
        dateGrain: { column: 'Show Date', dateTimeElement: 'MONTH' },
        orderBy: [{ column: 'show date', order: 'desc' }],
      };
      const plan = planCard(card, [], meta, 0);
      expect(plan.orderBy).toEqual([
        { column: 'show date', direction: 'DESC', dateGroup: plan.dateGroup, columnMeta: col('Show Date') },
      ]);
    });

    it.each([
      ['sort', { sort: [{ field: 'Genre', direction: 'DESC' }] }],
      ['sortBy', { sortBy: { name: 'Genre', direction: 'DESC' } }],
    ])('reads the order from %s', (_key, extra) => {
      expect(planCard({ ...grouped, ...extra }, [], meta, 0).orderBy).toEqual([
        { column: 'Genre', direction: 'DESC', columnMeta: col('Genre'), aggregation: null },
      ]);
    });

    it('prefers orderBy over sort and sortBy', () => {
      const card = { ...grouped, orderBy: 'Genre', sort: 'Revenue', sortBy: 'Revenue' };
      expect(planCard(card, [], meta, 0).orderBy.map((o: any) => o.column)).toEqual(['Genre']);
    });

    it('keeps several terms in order and skips entries that are not objects or strings', () => {
      const card = { ...grouped, orderBy: [null, 5, 'Revenue', { column: 'Genre', direction: 'ASC' }] };
      expect(planCard(card, [], meta, 0).orderBy.map((o: any) => [o.column, o.direction])).toEqual([
        ['Revenue', 'ASC'],
        ['Genre', 'ASC'],
      ]);
    });

    it('allows any column on an ungrouped card', () => {
      const card = { id: 'list', columns: [], orderBy: 'Movie Name' };
      expect(planCard(card, [], meta, 0).orderBy).toEqual([
        { column: 'Movie Name', direction: 'ASC', columnMeta: col('Movie Name'), aggregation: null },
      ]);
    });

    it('rejects a column that is neither grouped nor aggregated', () => {
      expect(() => planCard({ ...grouped, orderBy: 'Seats Sold' }, [], meta, 0)).toThrow(
        `orderBy column "Seats Sold" must be one of the card's groupBy dimensions or measures, ` +
          'or must specify an "aggregation".'
      );
    });

    it('rejects an entry without a column name', () => {
      expect(() => planCard({ ...grouped, orderBy: [{ direction: 'DESC' }] }, [], meta, 0)).toThrow(
        'Invalid orderBy entry: expected a "column" (or "field") name'
      );
    });

    it('rejects a column that is not in the table', () => {
      expect(() => planCard({ ...grouped, orderBy: 'Popularity' }, [], meta, 0)).toThrow(
        'Unknown column "Popularity" in table "cinema_analysis"'
      );
    });

    it('rejects a direction that is not ASC or DESC', () => {
      expect(() =>
        planCard({ ...grouped, orderBy: [{ column: 'Genre', direction: 'DESC; DROP TABLE x' }] }, [], meta, 0)
      ).toThrow('Unsupported sort direction "DESC; DROP TABLE x"');
    });

    it('rejects an explicit aggregation that does not fit the column', () => {
      expect(() => planCard({ ...grouped, orderBy: [{ column: 'Genre', aggregation: 'SUM' }] }, [], meta, 0)).toThrow(
        'Aggregation "SUM" requires a numeric column, but "Genre" in table "cinema_analysis" is text (text).'
      );
    });
  });
});

describe('planSlicer', () => {
  it('plans a slicer on its resolved column', () => {
    const slicer = SLICERS[0];
    expect(planSlicer(slicer, meta, 3)).toEqual({
      kind: 'slicer',
      id: 'sGenre',
      specIndex: 3,
      slicer,
      source: SOURCE,
      column: 'Genre',
      columnMeta: col('Genre'),
    });
    expect(resolveColumn).toHaveBeenCalledWith(meta.table, 'Genre');
  });

  it('resolves the slicer column case-insensitively', () => {
    const plan = planSlicer({ id: 's', column: 'THEATER NAME' }, meta, 0);
    expect(plan.column).toBe('THEATER NAME');
    expect(plan.columnMeta).toBe(col('Theater Name'));
  });

  it('rejects a slicer column that is not in the table', () => {
    expect(() => planSlicer(SLICERS[2], meta, 2)).toThrow('Unknown column "Ghost Status" in table "cinema_analysis"');
  });
});
