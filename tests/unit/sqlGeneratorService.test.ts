import { describe, expect, it, vi } from 'vitest';
import { DATE_TYPES, NUMERIC_TYPES, STRING_TYPES } from '../../src/modules/queryEngine/queryConstants';
import { optimizePlans } from '../../src/modules/queryEngine/queryOptimizerService';
import { buildFilters, planCard, planKpi, planSlicer } from '../../src/modules/queryEngine/queryPlannerService';
import { generateSql } from '../../src/modules/queryEngine/sqlGeneratorService';
import { splitPlaceholders } from '../../src/shared/db/sql';
import type {
  ColumnMeta,
  DateGroupNode,
  DimensionNode,
  FilterNode,
  KpiMergedPlan,
  KpiPeriodPlan,
  MeasureNode,
  QueryPlan,
  SlicerPlan,
} from '../../src/modules/queryEngine/queryTypes';

vi.mock('../../src/modules/queryEngine/metadataService', () => ({
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

type Node = Record<string, any>;

const SOURCE = { database: 'elze', schema: 'public', table: 'cinema_analysis' };
const FROM = 'FROM "public"."cinema_analysis"';

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

const bookingId = column('Booking Id', 'text');
const bookingDate = column('Booking Date', 'text');
const showDate = column('Show Date', 'date');
const genre = column('Genre', 'text');
const theater = column('Theater Name', 'varchar', 'character varying(120)');
const movie = column('Movie Name', 'text');
const revenue = column('Revenue', 'numeric', 'numeric(12,2)');
const budget = column('Budget', 'numeric', 'numeric(12,2)');
const rating = column('AVG RATING', 'float8', 'double precision');
const seats = column('Seats Sold', 'int4', 'integer');

function measure(columnMeta: ColumnMeta, aggregation: string, alias: string = columnMeta.name): MeasureNode {
  return { column: columnMeta.name, aggregation, alias, columnMeta };
}

function dimension(columnMeta: ColumnMeta): DimensionNode {
  return { column: columnMeta.name, columnMeta };
}

function inFilter(columnMeta: ColumnMeta, values: string[]): FilterNode {
  return { column: columnMeta.name, operator: 'IN', values, columnMeta };
}

function dateGroup(columnMeta: ColumnMeta, grain: string, parseFormat: string | null = null): DateGroupNode {
  return { column: columnMeta.name, grain, isString: columnMeta.isString, parseFormat, columnMeta };
}

function kpiPlan(overrides: Node): QueryPlan {
  return {
    kind: 'kpi-simple',
    id: 'kpi',
    specIndex: 0,
    kpi: {},
    source: SOURCE,
    measures: [measure(revenue, 'SUM', '_value')],
    dateGroup: null,
    orderBy: [],
    filters: [],
    limit: null,
    ...overrides,
  };
}

function cardPlan(overrides: Node): QueryPlan {
  return {
    kind: 'card',
    id: 'card',
    specIndex: 0,
    card: {},
    chartType: 'bar',
    source: SOURCE,
    measures: [],
    dimensions: [],
    dateGroup: null,
    orderBy: [],
    limit: null,
    filters: [],
    ...overrides,
  };
}

function slicerPlan(columnMeta: ColumnMeta): SlicerPlan {
  return {
    kind: 'slicer',
    id: 's',
    specIndex: 0,
    slicer: {} as SlicerPlan['slicer'],
    source: SOURCE,
    column: columnMeta.name,
    columnMeta,
  };
}

const bookingMonth = dateGroup(bookingDate, 'MONTH', 'DD-Mon-YY');
const BOOKING_MONTH_SQL = `to_char(to_date("Booking Date", 'DD-Mon-YY'), 'YYYY-MM')`;

describe('generateSql', () => {
  it('rejects an unknown plan kind', () => {
    expect(() => generateSql({ kind: 'pivot' } as unknown as QueryPlan)).toThrow('Unknown plan kind: pivot');
  });

  it('reports the plan kind and the plan itself alongside the SQL', () => {
    const plan = kpiPlan({});
    const result = generateSql(plan);
    expect(result.meta.type).toBe('kpi-simple');
    expect(result.meta.plan).toBe(plan);
  });
});

describe('generateSql for a simple KPI', () => {
  it('selects a single aliased aggregate', () => {
    expect(generateSql(kpiPlan({}))).toMatchObject({
      sql: `SELECT SUM("Revenue") AS "_value" ${FROM}`,
      params: [],
    });
  });

  it('applies the filters as a parameterised WHERE clause', () => {
    const plan = kpiPlan({
      measures: [measure(bookingId, 'COUNT_DISTINCT', '_value')],
      filters: [inFilter(genre, ['Drama', 'Comedy']), inFilter(theater, ['Regal'])],
    });
    expect(generateSql(plan)).toMatchObject({
      sql: `SELECT COUNT(DISTINCT "Booking Id") AS "_value" ${FROM} WHERE "Genre" IN (?, ?) AND "Theater Name" IN (?)`,
      params: ['Drama', 'Comedy', 'Regal'],
    });
  });

  it('rejects an aggregation that is not on the allow list', () => {
    expect(() => generateSql(kpiPlan({ measures: [measure(revenue, 'PERCENTILE', '_value')] }))).toThrow(
      'Unknown aggregation "PERCENTILE"'
    );
  });
});

describe('generateSql for a period KPI', () => {
  it('buckets a text date through its parse format and orders the periods', () => {
    const plan = kpiPlan({ kind: 'kpi-period', dateGroup: bookingMonth });
    expect(generateSql(plan)).toMatchObject({
      sql:
        `SELECT ${BOOKING_MONTH_SQL} AS "_period", SUM("Revenue") AS "_value" ${FROM} ` +
        'GROUP BY "_period" ORDER BY "_period" ASC',
      params: [],
    });
  });

  it('buckets a native date column directly and filters before grouping', () => {
    const plan = kpiPlan({
      kind: 'kpi-period',
      measures: [measure(rating, 'AVG', '_value')],
      dateGroup: dateGroup(showDate, 'WEEK'),
      filters: [inFilter(genre, ['Drama'])],
    });
    expect(generateSql(plan)).toMatchObject({
      sql:
        `SELECT to_char("Show Date", 'IYYY"-W"IW') AS "_period", AVG("AVG RATING") AS "_value" ${FROM} ` +
        'WHERE "Genre" IN (?) GROUP BY "_period" ORDER BY "_period" ASC',
      params: ['Drama'],
    });
  });

  it('rejects a text date column without a parse format', () => {
    const plan = kpiPlan({ kind: 'kpi-period', dateGroup: dateGroup(bookingDate, 'MONTH') });
    expect(() => generateSql(plan)).toThrow('Date column "Booking Date" has a string type.');
  });
});

describe('generateSql for merged period KPIs', () => {
  it('selects every member under its own alias in one grouped query', () => {
    const plan: KpiMergedPlan = {
      kind: 'kpi-period-merged',
      id: 'kpis:totalRevenue+totalBookings',
      specIndex: 0,
      source: SOURCE,
      members: [
        {
          id: 'totalRevenue',
          specIndex: 0,
          kpi: {},
          measure: measure(revenue, 'SUM', '_value'),
          alias: 'totalRevenue__value',
        },
        {
          id: 'totalBookings',
          specIndex: 1,
          kpi: {},
          measure: measure(bookingId, 'COUNT_DISTINCT', '_value'),
          alias: 'totalBookings__value',
        },
      ],
      dateGroup: bookingMonth,
      orderBy: [],
      filters: [inFilter(genre, ['Drama'])],
      limit: null,
    };
    expect(generateSql(plan)).toMatchObject({
      sql:
        `SELECT ${BOOKING_MONTH_SQL} AS "_period", SUM("Revenue") AS "totalRevenue__value", ` +
        `COUNT(DISTINCT "Booking Id") AS "totalBookings__value" ${FROM} WHERE "Genre" IN (?) ` +
        'GROUP BY "_period" ORDER BY "_period" ASC',
      params: ['Drama'],
    });
  });
});

describe('generateSql for a card', () => {
  const byGenre = { dimensions: [dimension(genre)], measures: [measure(revenue, 'SUM')] };

  it('groups by the dimensions and orders by the first measure descending by default', () => {
    expect(generateSql(cardPlan(byGenre))).toMatchObject({
      sql: `SELECT "Genre" AS "Genre", SUM("Revenue") AS "Revenue" ${FROM} GROUP BY "Genre" ORDER BY SUM("Revenue") DESC`,
      params: [],
    });
  });

  it('appends the limit after the order', () => {
    expect(generateSql(cardPlan({ ...byGenre, limit: 5 })).sql).toBe(
      `SELECT "Genre" AS "Genre", SUM("Revenue") AS "Revenue" ${FROM} GROUP BY "Genre" ` +
        'ORDER BY SUM("Revenue") DESC LIMIT 5'
    );
  });

  it.each([null, 0, Number.NaN])('omits LIMIT when the limit is %j', (limit) => {
    expect(generateSql(cardPlan({ ...byGenre, limit })).sql).not.toContain('LIMIT');
  });

  it('places the WHERE clause before GROUP BY', () => {
    const plan = cardPlan({ ...byGenre, filters: [inFilter(theater, ['Regal'])], limit: 10 });
    expect(generateSql(plan)).toMatchObject({
      sql:
        `SELECT "Genre" AS "Genre", SUM("Revenue") AS "Revenue" ${FROM} WHERE "Theater Name" IN (?) ` +
        'GROUP BY "Genre" ORDER BY SUM("Revenue") DESC LIMIT 10',
      params: ['Regal'],
    });
  });

  it('groups by the date bucket expression and orders by its alias', () => {
    const plan = cardPlan({ measures: [measure(revenue, 'SUM')], dateGroup: dateGroup(showDate, 'DAY') });
    expect(generateSql(plan).sql).toBe(
      `SELECT to_char("Show Date", 'YYYY-MM-DD') AS "Show Date", SUM("Revenue") AS "Revenue" ${FROM} ` +
        `GROUP BY to_char("Show Date", 'YYYY-MM-DD') ORDER BY "Show Date" ASC`
    );
  });

  it('selects the date bucket first, then dimensions, then measures', () => {
    const plan = cardPlan({
      dateGroup: bookingMonth,
      dimensions: [dimension(genre)],
      measures: [measure(revenue, 'SUM'), measure(bookingId, 'COUNT_DISTINCT')],
    });
    expect(generateSql(plan).sql).toBe(
      `SELECT ${BOOKING_MONTH_SQL} AS "Booking Date", "Genre" AS "Genre", SUM("Revenue") AS "Revenue", ` +
        `COUNT(DISTINCT "Booking Id") AS "Booking Id" ${FROM} GROUP BY ${BOOKING_MONTH_SQL}, "Genre" ` +
        'ORDER BY "Booking Date" ASC'
    );
  });

  it('neither groups nor orders a card that only has measures', () => {
    const plan = cardPlan({ measures: [measure(revenue, 'SUM'), measure(rating, 'AVG')] });
    expect(generateSql(plan).sql).toBe(`SELECT SUM("Revenue") AS "Revenue", AVG("AVG RATING") AS "AVG RATING" ${FROM}`);
  });

  it('groups without ordering a card that only has dimensions', () => {
    const plan = cardPlan({ dimensions: [dimension(genre), dimension(theater)] });
    expect(generateSql(plan).sql).toBe(
      `SELECT "Genre" AS "Genre", "Theater Name" AS "Theater Name" ${FROM} GROUP BY "Genre", "Theater Name"`
    );
  });

  it('renders explicit order terms in place of the default order', () => {
    const plan = cardPlan({
      ...byGenre,
      orderBy: [
        { column: 'Genre', direction: 'DESC', columnMeta: genre, aggregation: null },
        { column: 'Seats Sold', direction: 'asc', columnMeta: seats, aggregation: 'MAX' },
        { column: 'Revenue', columnMeta: revenue, aggregation: 'SUM' },
      ],
    });
    expect(generateSql(plan).sql).toBe(
      `SELECT "Genre" AS "Genre", SUM("Revenue") AS "Revenue" ${FROM} GROUP BY "Genre" ` +
        'ORDER BY "Genre" DESC, MAX("Seats Sold") ASC, SUM("Revenue") ASC'
    );
  });

  it('orders by the date bucket alias when an order term points at the date group', () => {
    const group = dateGroup(showDate, 'YEAR');
    const plan = cardPlan({
      measures: [measure(seats, 'SUM')],
      dateGroup: group,
      orderBy: [{ column: 'Show Date', direction: 'DESC', dateGroup: group, columnMeta: showDate }],
    });
    expect(generateSql(plan).sql).toBe(
      `SELECT to_char("Show Date", 'YYYY') AS "Show Date", SUM("Seats Sold") AS "Seats Sold" ${FROM} ` +
        `GROUP BY to_char("Show Date", 'YYYY') ORDER BY "Show Date" DESC`
    );
  });

  it('references real column names but aliases with the spec names', () => {
    const plan = cardPlan({
      dimensions: [{ column: 'genre', columnMeta: genre }],
      measures: [{ column: 'revenue', aggregation: 'SUM', alias: 'revenue', columnMeta: revenue }],
      dateGroup: { ...dateGroup(showDate, 'YEAR'), column: 'show date' },
    });
    expect(generateSql(plan).sql).toBe(
      `SELECT to_char("Show Date", 'YYYY') AS "show date", "Genre" AS "genre", SUM("Revenue") AS "revenue" ${FROM} ` +
        `GROUP BY to_char("Show Date", 'YYYY'), "Genre" ORDER BY "show date" ASC`
    );
  });

  it('rejects an order term with an unsupported direction', () => {
    const plan = cardPlan({
      ...byGenre,
      orderBy: [{ column: 'Genre', direction: 'DESC NULLS FIRST; --', columnMeta: genre, aggregation: null }],
    });
    expect(() => generateSql(plan)).toThrow('Unsupported sort direction "DESC NULLS FIRST; --"');
  });

  it('refuses to render a dimension that was never resolved', () => {
    const plan = cardPlan({ dimensions: [{ column: 'Genre' }], measures: [measure(revenue, 'SUM')] });
    expect(() => generateSql(plan)).toThrow(
      'Plan node for column "Genre" has no resolved metadata; it cannot be rendered safely.'
    );
  });
});

describe('generateSql for a slicer', () => {
  it('lists the distinct non-empty values of a text column with counts', () => {
    expect(generateSql(slicerPlan(genre))).toMatchObject({
      sql:
        `SELECT "Genre" AS "value", COUNT(*) AS "count" ${FROM} ` +
        `WHERE "Genre" IS NOT NULL AND "Genre" <> '' GROUP BY "Genre" ORDER BY "Genre" ASC`,
      params: [],
    });
  });

  it('only excludes NULL for a non-text column', () => {
    expect(generateSql(slicerPlan(seats)).sql).toBe(
      `SELECT "Seats Sold" AS "value", COUNT(*) AS "count" ${FROM} ` +
        'WHERE "Seats Sold" IS NOT NULL GROUP BY "Seats Sold" ORDER BY "Seats Sold" ASC'
    );
  });

  it('uses the resolved column name rather than the spec name', () => {
    const plan = { ...slicerPlan(theater), column: 'theater name' };
    expect(generateSql(plan).sql).toBe(
      `SELECT "Theater Name" AS "value", COUNT(*) AS "count" ${FROM} ` +
        `WHERE "Theater Name" IS NOT NULL AND "Theater Name" <> '' GROUP BY "Theater Name" ORDER BY "Theater Name" ASC`
    );
  });

  it('refuses a slicer whose column was never resolved', () => {
    expect(() => generateSql({ kind: 'slicer', column: 'Genre', source: SOURCE } as SlicerPlan)).toThrow(
      'Plan node for column "Genre" has no resolved metadata'
    );
  });
});

describe('generateSql injection safety', () => {
  const hostile = ["Drama' OR '1'='1", 'x"; DROP TABLE users; --', "'); DELETE FROM cinema_analysis; --", '?'];

  it('binds hostile filter values as parameters and never inlines them', () => {
    const plan = cardPlan({
      dimensions: [dimension(genre)],
      measures: [measure(revenue, 'SUM')],
      filters: [inFilter(genre, hostile)],
    });
    const { sql, params } = generateSql(plan);
    expect(sql).toBe(
      `SELECT "Genre" AS "Genre", SUM("Revenue") AS "Revenue" ${FROM} WHERE "Genre" IN (?, ?, ?, ?) ` +
        'GROUP BY "Genre" ORDER BY SUM("Revenue") DESC'
    );
    expect(params).toEqual(hostile);
    for (const value of hostile.slice(0, 3)) {
      expect(sql).not.toContain(value);
    }
  });

  it('doubles embedded double quotes in schema, table, column and alias identifiers', () => {
    const odd = column('Reve"nue', 'numeric');
    const plan = cardPlan({
      source: { database: 'elze', schema: 'pub"lic', table: 'cinema"; DROP TABLE users; --' },
      measures: [measure(odd, 'SUM', 'total"; --')],
    });
    expect(generateSql(plan).sql).toBe(
      'SELECT SUM("Reve""nue") AS "total""; --" FROM "pub""lic"."cinema""; DROP TABLE users; --"'
    );
  });

  it('quotes a merged KPI alias built from a card id', () => {
    const plan = {
      kind: 'kpi-period-merged',
      source: SOURCE,
      members: [{ measure: measure(revenue, 'SUM'), alias: 'rev" FROM x; --__value' }],
      dateGroup: dateGroup(showDate, 'YEAR'),
      filters: [],
    } as unknown as KpiMergedPlan;
    expect(generateSql(plan).sql).toBe(
      `SELECT to_char("Show Date", 'YYYY') AS "_period", SUM("Revenue") AS "rev"" FROM x; --__value" ${FROM} ` +
        'GROUP BY "_period" ORDER BY "_period" ASC'
    );
  });

  it('escapes a single quote in a date parse format', () => {
    const plan = kpiPlan({ kind: 'kpi-period', dateGroup: dateGroup(bookingDate, 'YEAR', "YYYY'), 'x') --") });
    expect(generateSql(plan).sql).toBe(
      `SELECT to_char(to_date("Booking Date", 'YYYY''), ''x'') --'), 'YYYY') AS "_period", SUM("Revenue") AS "_value" ` +
        `${FROM} GROUP BY "_period" ORDER BY "_period" ASC`
    );
  });

  it('keeps one bindable placeholder per parameter when identifiers and literals contain ? and comment markers', () => {
    const oddDate = column('Booking "Date?"', 'text');
    const oddGenre = column('Genre -- ?', 'text');
    const oddRevenue = column('Revenue /* ? */', 'numeric');
    const plan = cardPlan({
      dateGroup: dateGroup(oddDate, 'MONTH', "DD-Mon-YY'?'"),
      measures: [measure(oddRevenue, 'SUM')],
      filters: [inFilter(oddGenre, ['?', "x' OR '1'='1"]), inFilter(oddRevenue, ['100'])],
    });
    const { sql, params } = generateSql(plan);
    const bucket = `to_char(to_date("Booking ""Date?""", 'DD-Mon-YY''?'''), 'YYYY-MM')`;
    expect(sql).toBe(
      `SELECT ${bucket} AS "Booking ""Date?""", SUM("Revenue /* ? */") AS "Revenue /* ? */" ${FROM} ` +
        `WHERE "Genre -- ?" IN (?, ?) AND "Revenue /* ? */"::text IN (?) GROUP BY ${bucket} ` +
        'ORDER BY "Booking ""Date?""" ASC'
    );
    expect(params).toEqual(['?', "x' OR '1'='1", '100']);
    expect(splitPlaceholders(sql)).toHaveLength(params.length + 1);
  });

  it('rejects a filter operator outside the allow list', () => {
    const plan = kpiPlan({ filters: [{ ...inFilter(genre, ['x']), operator: '= 1 OR 1' }] });
    expect(() => generateSql(plan)).toThrow('Unsupported filter operator "= 1 OR 1"');
  });
});

describe('generateSql from planned dashboard specs', () => {
  const columns = [bookingId, bookingDate, showDate, genre, theater, movie, revenue, budget, rating, seats];
  const columnMap = new Map(columns.map((c) => [c.name, c]));
  const byLower = new Map(columns.map((c) => [c.name.toLowerCase(), c]));
  const meta = {
    source: { ...SOURCE },
    table: { ...SOURCE, columns, columnMap, byLower },
    columns: columnMap,
    dateParse: { 'Booking Date': 'DD-Mon-YY' },
  };

  const slicers = [
    { id: 'sGenre', title: 'Genre', column: 'Genre', type: 'multi' },
    { id: 'sTheater', title: 'Theater', column: 'Theater Name', type: 'multi' },
  ];

  const comparisonKpi = (id: string, columnName: string, aggregation: string) => ({
    id,
    chartType: 'badge_multi_value',
    columns: [{ column: columnName, mapping: 'VALUE', aggregation }],
    dateGrain: { column: 'Booking Date', dateTimeElement: 'MONTH' },
    comparison: { label: 'vs last month' },
  });

  const revenueByMovie = {
    id: 'revenueByMovie',
    chartType: 'line_bar_combo',
    columns: [
      { column: 'Movie Name', mapping: 'XTIME' },
      { column: 'Budget', mapping: 'VALUE', aggregation: 'SUM' },
    ],
    groupBy: [{ column: 'Movie Name' }],
    limits: 5,
  };

  it('merges comparison KPIs that share a period into one parameterised query', () => {
    const kpis = [
      comparisonKpi('totalRevenue', 'Revenue', 'SUM'),
      comparisonKpi('totalBookings', 'Booking Id', 'COUNTDISTINCT'),
      comparisonKpi('avgRating', 'AVG RATING', 'AVERAGE'),
    ];
    const filters = buildFilters({ slicers }, { sGenre: ['Drama'], sTheater: ['Regal', 'AMC'] }, meta);
    const periodPlans = kpis.map((kpi, index) => planKpi(kpi, filters, meta, index)) as KpiPeriodPlan[];
    const { optimizedKpiPlans } = optimizePlans({ periodPlans, simplePlans: [] });

    expect(optimizedKpiPlans).toHaveLength(1);
    expect(generateSql(optimizedKpiPlans[0])).toMatchObject({
      sql:
        `SELECT ${BOOKING_MONTH_SQL} AS "_period", SUM("Revenue") AS "totalRevenue__value", ` +
        `COUNT(DISTINCT "Booking Id") AS "totalBookings__value", AVG("AVG RATING") AS "avgRating__value" ${FROM} ` +
        'WHERE "Genre" IN (?) AND "Theater Name" IN (?, ?) GROUP BY "_period" ORDER BY "_period" ASC',
      params: ['Drama', 'Regal', 'AMC'],
    });
  });

  it('renders a KPI without a comparison as a single aggregate', () => {
    const kpi = { id: 'seats', chartType: 'badge_multi_value', columns: [{ column: 'Seats Sold', mapping: 'VALUE' }] };
    expect(generateSql(planKpi(kpi, [], meta, 0))).toMatchObject({
      sql: `SELECT SUM("Seats Sold") AS "_value" ${FROM}`,
      params: [],
    });
  });

  it('renders a grouped chart card with its default order and limit', () => {
    const filters = buildFilters({ slicers }, { sGenre: ['Drama', 'Action'] }, meta);
    expect(generateSql(planCard(revenueByMovie, filters, meta, 4))).toMatchObject({
      sql:
        `SELECT "Movie Name" AS "Movie Name", SUM("Budget") AS "Budget" ${FROM} WHERE "Genre" IN (?, ?) ` +
        'GROUP BY "Movie Name" ORDER BY SUM("Budget") DESC LIMIT 5',
      params: ['Drama', 'Action'],
    });
  });

  it('renders a weekly time series ordered by the requested measure', () => {
    const card = {
      id: 'weekly',
      chartType: 'line',
      columns: [
        { column: 'Show Date', mapping: 'XTIME' },
        { column: 'Revenue', mapping: 'VALUE', aggregation: 'SUM' },
      ],
      dateGrain: { column: 'Show Date', dateTimeElement: 'WEEK' },
      orderBy: [{ column: 'Revenue', direction: 'desc' }],
    };
    expect(generateSql(planCard(card, [], meta, 0)).sql).toBe(
      `SELECT to_char("Show Date", 'IYYY"-W"IW') AS "Show Date", SUM("Revenue") AS "Revenue" ${FROM} ` +
        `GROUP BY to_char("Show Date", 'IYYY"-W"IW') ORDER BY SUM("Revenue") DESC`
    );
  });

  it('resolves spec column names case-insensitively to the real columns', () => {
    const card = {
      id: 'byGenre',
      chartType: 'bar',
      columns: [
        { column: 'genre', mapping: 'SERIES' },
        { column: 'REVENUE', mapping: 'VALUE' },
      ],
    };
    expect(generateSql(planCard(card, [], meta, 0)).sql).toBe(
      `SELECT "Genre" AS "genre", SUM("Revenue") AS "REVENUE" ${FROM} GROUP BY "Genre" ORDER BY SUM("Revenue") DESC`
    );
  });

  it('renders slicer option queries without the request filters', () => {
    expect(generateSql(planSlicer(slicers[1], meta, 1))).toMatchObject({
      sql:
        `SELECT "Theater Name" AS "value", COUNT(*) AS "count" ${FROM} ` +
        `WHERE "Theater Name" IS NOT NULL AND "Theater Name" <> '' GROUP BY "Theater Name" ORDER BY "Theater Name" ASC`,
      params: [],
    });
  });

  it('binds hostile slicer selections from the request as parameters', () => {
    const hostile = ["Drama' OR '1'='1", '"; DROP TABLE cinema_analysis; --', "') UNION SELECT password FROM users --"];
    const filters = buildFilters({ slicers }, { sGenre: hostile }, meta);
    const { sql, params } = generateSql(planCard(revenueByMovie, filters, meta, 0));
    expect(sql).toBe(
      `SELECT "Movie Name" AS "Movie Name", SUM("Budget") AS "Budget" ${FROM} WHERE "Genre" IN (?, ?, ?) ` +
        'GROUP BY "Movie Name" ORDER BY SUM("Budget") DESC LIMIT 5'
    );
    expect(params).toEqual(hostile);
    for (const value of hostile) {
      expect(sql).not.toContain(value);
    }
    expect(splitPlaceholders(sql)).toHaveLength(params.length + 1);
  });

  it('never inlines anything but a whole number as the card limit', () => {
    expect(generateSql(planCard({ ...revenueByMovie, limits: '5' }, [], meta, 0)).sql.endsWith(' LIMIT 5')).toBe(true);
    expect(() => planCard({ ...revenueByMovie, limits: '5; DROP TABLE cinema_analysis' }, [], meta, 0)).toThrow(
      'Card "limits" must be a whole number'
    );
  });

  it('omits LIMIT when a card limit is not a number', () => {
    const card = { ...revenueByMovie, limits: 'all' };
    expect(generateSql(planCard(card, [], meta, 0)).sql).not.toContain('LIMIT');
  });
});
