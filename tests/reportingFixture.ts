import config from '../src/config';
const { db } = config.database;
import { quoteIdentifier } from '../src/tools/sql';

const COLUMNS: [string, string][] = [
  ['Booking Date', 'text'],
  ['Booking Id', 'text'],
  ['Booking Type', 'text'],
  ['Genre', 'text'],
  ['Movie Name', 'text'],
  ['Status', 'text'],
  ['Theater Name', 'text'],
  ['AVG RATING', 'double precision'],
  ['Budget', 'double precision'],
  ['OCCUPANCY RATE', 'double precision'],
  ['Revenue', 'double precision'],
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const GENRES = ['Action', 'Comedy', 'Drama', 'Horror', 'Romantic', 'Thriller'];
const STATUSES = ['Confirmed', 'Pending', 'Cancelled'];
const TYPES = ['Online', 'Offline'];
const THEATERS = ['Williams PLC', 'Bell-White', 'Matthews-Rogers'];
const MOVIES = ['Funny Business', 'Silent Threat', 'The Promise', 'Red Alert'];

function hash(i: number, salt: number): number {
  let h = (i + 1) * 2654435761 + salt * 40503;
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

const pick = (list: string[], i: number, salt: number): string => list[hash(i, salt) % list.length];

function buildRow(i: number): (string | number)[] {
  const day = (hash(i, 2) % 27) + 1;
  return [
    `${day}-${MONTHS[hash(i, 1) % 12]}-23`,
    `B${10000 + i}`,
    pick(TYPES, i, 5),
    pick(GENRES, i, 3),
    pick(MOVIES, i, 7),
    pick(STATUSES, i, 4),
    pick(THEATERS, i, 6),
    Number(((hash(i, 11) % 100) / 10).toFixed(1)),
    Number(((hash(i, 12) % 90000) / 10).toFixed(2)),
    Number(((hash(i, 13) % 1000) / 10).toFixed(1)),
    Number(((hash(i, 14) % 50000) / 10).toFixed(2)),
  ];
}

const q = quoteIdentifier;

const FIXTURE_MARKER = 'rbac.e2e synthetic fixture - safe to drop';

async function fixtureMarker(schema: string, table: string): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT obj_description(c.oid) AS comment
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ? AND c.relname = ? AND c.relkind = 'r'`,
    [schema, table]
  );
  return rows.length ? rows[0].comment : null;
}

async function createReportingFixture(
  { schema = 'public', table = 'cinema_analysis', rows = 600 }: { schema?: string; table?: string; rows?: number } = {}
): Promise<{ schema: string; table: string; rows: number }> {
  const ref = `${q(schema)}.${q(table)}`;

  const existing = await fixtureMarker(schema, table);
  if (existing !== null && existing !== FIXTURE_MARKER) {
    const { rows: where } = await db.query('SELECT current_database() AS db');
    throw new Error(
      `Refusing to replace ${schema}.${table} in database "${where[0].db}": it was not created by ` +
      'this fixture, and dropping it would destroy real data. Point the suite at a throwaway ' +
      'database - set DB_NAME on the test process as well as on the server.'
    );
  }

  await db.raw(`DROP TABLE IF EXISTS ${ref}`);
  await db.raw(`CREATE TABLE ${ref} (${COLUMNS.map(([n, t]) => `${q(n)} ${t} NULL`).join(', ')})`);
  await db.raw(`COMMENT ON TABLE ${ref} IS '${FIXTURE_MARKER}'`);

  const cols = COLUMNS.map(([n]) => q(n)).join(', ');
  const values: string[] = [];
  const params: (string | number)[] = [];
  for (let i = 0; i < rows; i++) {
    const row = buildRow(i);
    const base = params.length;
    values.push('(' + row.map((_, k) => `$${base + k + 1}`).join(', ') + ')');
    params.push(...row);
  }
  await db.raw(`INSERT INTO ${ref} (${cols}) VALUES ${values.join(', ')}`, params);

  return { schema, table, rows };
}

export { createReportingFixture };
