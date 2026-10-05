import { Client } from 'pg';
import config from '../src/config';
const { db } = config.database;
import { bootstrapAppMeta } from '../src/services/bootstrap.service';

const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_REPORTING = process.argv.includes('--skip-reporting');

interface TableSpec {
  name: string;
  conflict: string;
  identity?: string;
  from?: string;
}

interface CopyResult {
  table: string;
  copied: number;
  skipped?: boolean;
  dryRun?: boolean;
}

const TABLES: TableSpec[] = [
  { name: 'companies', conflict: '(id)', identity: 'id' },
  { name: 'roles', conflict: '(name)', identity: 'id' },
  { name: 'role_permissions', conflict: '(role_name, permission_id)' },
  { name: 'users', conflict: '(id)', identity: 'id' },
  { name: 'groups', conflict: '(id)', identity: 'id' },
  { name: 'group_users', conflict: '(group_id, user_id)' },
  { name: 'dashboards', conflict: '(id)' },
  { name: 'company_dashboards', conflict: '(company_id, dashboard_id)' },
  { name: 'dashboard_access', conflict: '(user_id, dashboard_id)' },
  { name: 'group_dashboard_access', conflict: '(group_id, dashboard_id)' },
  { name: 'user_data_scope', conflict: '(user_id, dimension, value)' },
  { name: 'refresh_tokens', conflict: '(id)' },
  { name: 'user_tokens', conflict: '(id)' },
  { name: 'login_attempts', conflict: '(identifier)' },
  { name: 'permission_seed_log', conflict: '(permission_id)' },

  { name: 'connections', from: 'context_connections', conflict: '(id)' },
  { name: 'datasets', from: 'context_connection_datasets', conflict: '(connection_id, dataset_id)' },
];

const OURS = new Set([
  ...TABLES.map((t) => t.from || t.name),
  ...TABLES.map((t) => t.name),
]);

function log(...args: unknown[]): void {
  console.log(...args);
}

async function sharedColumns(source: Client, destTable: string, sourceTable: string): Promise<string[]> {
  const [{ rows: destCols }, { rows: srcCols }] = await Promise.all([
    db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = ?
        ORDER BY ordinal_position`,
      [destTable]
    ),
    source.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position`,
      [sourceTable]
    ),
  ]);

  if (!destCols.length) {
    return DRY_RUN ? srcCols.map((r) => r.column_name) : [];
  }
  const available = new Set<string>(srcCols.map((r) => r.column_name));
  return destCols.map((r): string => r.column_name).filter((c) => available.has(c));
}

function onConflict(spec: TableSpec, columns: string[]): string {
  if (!spec.conflict) return '';

  const keyColumns = new Set(
    spec.conflict.replace(/[()]/g, '').split(',').map((c) => c.trim())
  );
  const updatable = columns.filter((c) => !keyColumns.has(c));
  if (!updatable.length) return ` ON CONFLICT ${spec.conflict} DO NOTHING`;

  const assignments = updatable.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ');
  return ` ON CONFLICT ${spec.conflict} DO UPDATE SET ${assignments}`;
}

async function copyTable(source: Client, spec: TableSpec): Promise<CopyResult> {
  const sourceTable = spec.from || spec.name;
  const destTable = spec.name;

  const exists = await source.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1`,
    [sourceTable]
  );
  if (!exists.rows.length) {
    log(`  skip     ${destTable.padEnd(28)} (not in source)`);
    return { table: destTable, copied: 0, skipped: true };
  }

  const columns = await sharedColumns(source, destTable, sourceTable);
  if (!columns.length) {
    log(`  skip     ${destTable.padEnd(28)} (no columns in common)`);
    return { table: destTable, copied: 0, skipped: true };
  }

  const { rows } = await source.query(
    `SELECT ${columns.map((c) => `"${c}"`).join(', ')} FROM "${sourceTable}"`
  );
  if (!rows.length) {
    log(`  empty    ${destTable.padEnd(28)} 0 rows`);
    return { table: destTable, copied: 0 };
  }

  if (DRY_RUN) {
    log(`  would    ${destTable.padEnd(28)} ${String(rows.length).padStart(7)} rows`);
    return { table: destTable, copied: rows.length, dryRun: true };
  }

  const quoted = columns.map((c) => `"${c}"`).join(', ');
  const conflict = onConflict(spec, columns);
  const BATCH = 500;
  let copied = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const placeholders = batch
      .map(() => `(${columns.map(() => '?').join(', ')})`)
      .join(', ');
    const params = batch.flatMap((row) => columns.map((c) => row[c]));

    const result = await db.query(
      `INSERT INTO "${destTable}" (${quoted}) VALUES ${placeholders}${conflict}`,
      params
    );
    copied += result.rowCount ?? 0;
  }

  const note = copied === rows.length ? '' : ` (${rows.length - copied} left as they were)`;
  log(`  copied   ${destTable.padEnd(28)} ${String(copied).padStart(7)} rows${note}`);
  return { table: destTable, copied };
}

async function copyReportingTable(source: Client, name: string): Promise<CopyResult> {
  const { rows: cols } = await source.query(
    `SELECT column_name, data_type, character_maximum_length,
            numeric_precision, numeric_scale, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [name]
  );
  if (!cols.length) return { table: name, copied: 0, skipped: true };

  const ddl = cols
    .map((c) => {
      let type = c.data_type;
      if (c.character_maximum_length) type += `(${c.character_maximum_length})`;
      else if (c.data_type === 'numeric' && c.numeric_precision) {
        type += `(${c.numeric_precision},${c.numeric_scale || 0})`;
      }
      return `"${c.column_name}" ${type}${c.is_nullable === 'NO' ? ' NOT NULL' : ''}`;
    })
    .join(', ');

  const { rows } = await source.query(`SELECT * FROM "${name}"`);

  if (DRY_RUN) {
    log(`  would    ${name.padEnd(28)} ${String(rows.length).padStart(7)} rows (reporting)`);
    return { table: name, copied: rows.length, dryRun: true };
  }

  await db.raw(`CREATE TABLE IF NOT EXISTS "${name}" (${ddl})`);

  const { rows: [{ n }] } = await db.query(`SELECT COUNT(*)::int AS n FROM "${name}"`);
  if (n > 0) {
    log(`  skip     ${name.padEnd(28)} (destination already has ${n} rows)`);
    return { table: name, copied: 0, skipped: true };
  }

  const columns: string[] = cols.map((c) => c.column_name);
  const quoted = columns.map((c) => `"${c}"`).join(', ');
  const BATCH = 1000;
  let copied = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const placeholders = batch
      .map(() => `(${columns.map(() => '?').join(', ')})`)
      .join(', ');
    const params = batch.flatMap((row) => columns.map((c) => row[c]));
    const result = await db.query(
      `INSERT INTO "${name}" (${quoted}) VALUES ${placeholders}`,
      params
    );
    copied += result.rowCount ?? 0;

    if (rows.length > 5000 && i % 20000 === 0 && i > 0) {
      log(`           ${name.padEnd(28)} ${String(i).padStart(7)} / ${rows.length}…`);
    }
  }

  log(`  copied   ${name.padEnd(28)} ${String(copied).padStart(7)} rows (reporting)`);
  return { table: name, copied };
}

async function resyncSequences(): Promise<void> {
  for (const spec of TABLES) {
    if (!spec.identity) continue;
    await db.raw(
      `SELECT setval(
         pg_get_serial_sequence('"${spec.name}"', '${spec.identity}'),
         GREATEST(COALESCE((SELECT MAX("${spec.identity}") FROM "${spec.name}"), 0), 1),
         true
       )`
    );
  }
  log('  sequences resynced past the copied ids');
}

async function main(): Promise<void> {
  const sourceUrl = process.env.SOURCE_DB_URL;
  if (!sourceUrl) {
    console.error(
      'SOURCE_DB_URL is required - the database to copy FROM.\n' +
      '  SOURCE_DB_URL=postgresql://user:pass@localhost:5432/elze npm run migrate:db -- --dry-run\n\n' +
      'The destination is whatever backend/.env points at, so check DB_HOST first.'
    );
    process.exit(1);
  }

  const source = new Client({ connectionString: sourceUrl, connectionTimeoutMillis: 15000 });
  await source.connect();

  const { rows: [srcInfo] } = await source.query(
    'SELECT current_database() AS db, inet_server_addr()::text AS host'
  );
  const { rows: [dstInfo] } = await db.query(
    'SELECT current_database() AS db, version() AS version'
  );

  log('');
  log(`  source      ${srcInfo.db} (${srcInfo.host || 'local socket'})`);
  log(`  destination ${dstInfo.db} @ ${process.env.DB_HOST}`);
  log(`  mode        ${DRY_RUN ? 'DRY RUN - nothing will be written' : 'WRITING'}`);
  log('');

  if (srcInfo.db === dstInfo.db && process.env.DB_HOST === 'localhost') {
    console.error('  Source and destination look identical. Point backend/.env at the new database first.');
    process.exit(1);
  }

  if (!DRY_RUN) {
    log('  creating the destination schema (bootstrapAppMeta)…');
    await bootstrapAppMeta();
    log('  schema ready');
    log('');
  }

  log('  application tables');
  const results: CopyResult[] = [];
  for (const spec of TABLES) {
    results.push(await copyTable(source, spec));
  }

  if (!SKIP_REPORTING) {
    const { rows: allTables } = await source.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name`
    );
    const reporting = allTables
      .map((r): string => r.table_name)
      .filter((name) => !OURS.has(name));

    if (reporting.length) {
      log('');
      log('  reporting tables (the dashboards\' source data)');
      for (const name of reporting) {
        results.push(await copyReportingTable(source, name));
      }
    }
  } else {
    log('');
    log('  reporting tables skipped (--skip-reporting)');
  }

  if (!DRY_RUN) {
    log('');
    await resyncSequences();
  }

  await source.end();

  const total = results.reduce((sum, r) => sum + (r.copied || 0), 0);
  log('');
  log(`  ${DRY_RUN ? 'would copy' : 'copied'} ${total.toLocaleString('en-US')} rows across ${results.filter((r) => !r.skipped).length} tables`);
  if (DRY_RUN) log('  re-run without --dry-run to write.');
  log('');
}

main()
  .then(() => process.exit(0))
  .catch((err: any) => {
    console.error('\n  migration failed:', err.message);
    if (err.detail) console.error('  detail:', err.detail);
    if (err.hint) console.error('  hint:', err.hint);
    console.error('\n  Nothing is left half-written that a re-run will not fix:');
    console.error('  every insert is ON CONFLICT DO NOTHING, so running it again resumes.');
    process.exit(1);
  });
