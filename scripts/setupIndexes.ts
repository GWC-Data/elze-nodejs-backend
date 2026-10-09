import config from '../src/config';
const { db } = config.database;
import * as dashboards from '../src/services/dashboardService';
import { resolveSourceMetadata } from '../src/services/metadataService';
import { quoteIdentifier, quoteQualified } from '../src/tools/sql';

type ColMeta = Record<string, any>;
type Spec = Record<string, any>;

interface IndexTarget {
  expr: string;
  suffix: string;
  note: string;
}

const UNINDEXABLE_TYPES = new Set(['json', 'xml', 'point', 'polygon', 'line', 'lseg', 'path', 'box', 'circle']);

const MAX_IDENTIFIER_LENGTH = 63;

function parseArgs(argv: string[]): { ids: string[]; dryRun: boolean } {
  const ids: string[] = [];
  let dryRun = false;

  for (const arg of argv) {
    if (arg === '--dry-run' || arg === '-n') dryRun = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else ids.push(arg);
  }
  return { ids, dryRun };
}

function slug(value: unknown): string {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function indexName(table: string, column: string, suffix: string = ''): string {
  const base = `idx_${slug(table)}_${slug(column)}${suffix}`;
  return base.length <= MAX_IDENTIFIER_LENGTH
    ? base
    : base.slice(0, MAX_IDENTIFIER_LENGTH).replace(/_+$/, '');
}

function indexTargets(colMeta: ColMeta): { skip?: string; targets?: IndexTarget[] } {
  const type = String(colMeta.type || '').toLowerCase();
  if (UNINDEXABLE_TYPES.has(type)) {
    return { skip: `type ${type} cannot be indexed with a default btree` };
  }

  const col = quoteIdentifier(colMeta.name);
  const targets: IndexTarget[] = [{ expr: col, suffix: '', note: type }];

  if (!colMeta.isString) {
    targets.push({
      expr: `((${col})::text)`,
      suffix: '_text',
      note: `${type} cast to text, for slicer filters`,
    });
  }
  return { targets };
}

function candidateColumns(spec: Spec): string[] {
  const columns = new Set<string>();
  const add = (name: unknown) => {
    if (typeof name === 'string' && name.trim()) columns.add(name.trim());
  };
  const addGroupBy = (list: any[] | undefined) => {
    for (const g of list || []) add(g && g.column);
  };
  const addDateGrain = (node: any) => {
    if (node && node.dateGrain && typeof node.dateGrain === 'object') add(node.dateGrain.column);
  };

  for (const slicer of spec.slicers || []) add(slicer.column);

  for (const card of spec.cards || []) {
    addDateGrain(card);
    addGroupBy(card.groupBy);
    if (!(card.groupBy && card.groupBy.length)) {
      for (const col of card.columns || []) {
        if (['XTIME', 'SERIES', 'ITEM'].includes(col.mapping)) add(col.column);
      }
    }
    for (const term of ([] as any[]).concat(card.orderBy || [], card.sort || [])) {
      if (typeof term === 'string') add(term);
      else if (term) add(term.column || term.field || term.name);
    }
  }

  return [...columns];
}

async function existingIndexes(schema: string, table: string): Promise<{ leading: Set<string>; names: Set<string> }> {
  const { rows } = await db.query(
    `SELECT i.relname AS index_name,
            a.attname AS column_name,
            k.ordinality AS position
       FROM pg_class      t
       JOIN pg_namespace  n  ON n.oid = t.relnamespace
       JOIN pg_index      ix ON ix.indrelid = t.oid
       JOIN pg_class      i  ON i.oid = ix.indexrelid
       CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ordinality)
       LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE n.nspname = ? AND t.relname = ?`,
    [schema, table]
  );

  const leading = new Set<string>();
  const names = new Set<string>();
  for (const row of rows) {
    names.add(row.index_name);
    if (Number(row.position) === 1 && row.column_name) {
      leading.add(String(row.column_name).toLowerCase());
    }
  }
  return { leading, names };
}

(async () => {
  const { ids, dryRun } = parseArgs(process.argv.slice(2));

  // @ts-expect-error -- pre-existing bug kept as-is: this const shadows the imported module and reads itself in its own initializer
  const dashboards = ids.length ? ids : dashboards.listDashboards().map((d) => d.id);
  if (!dashboards.length) {
    console.log('No dashboards found. Nothing to index.');
    await db.end();
    return;
  }

  console.log(`Dashboards: ${dashboards.join(', ')}${dryRun ? '  (dry run)' : ''}`);

  const wanted = new Map<string, { schema: string; table: string; columns: Map<string, ColMeta> }>();

  for (const id of dashboards) {
    let spec: Spec;
    try {
      spec = dashboards.getSpec(id);
    } catch (err: any) {
      console.log(`! ${id}: ${err.message}`);
      continue;
    }

    let meta: Record<string, any>;
    try {
      meta = await resolveSourceMetadata(spec);
    } catch (err: any) {
      console.log(`! ${id}: ${err.message}`);
      continue;
    }

    const { schema, table } = meta.table;
    const key = `${schema}.${table}`;
    if (!wanted.has(key)) wanted.set(key, { schema, table, columns: new Map() });
    const entry = wanted.get(key)!;

    const resolved: string[] = [];
    for (const name of candidateColumns(spec)) {
      const colMeta = meta.table.columnMap.get(name) || meta.table.byLower.get(name.toLowerCase());
      if (!colMeta) {
        console.log(`! ${id}: column "${name}" is not in ${key}, skipping`);
        continue;
      }
      entry.columns.set(colMeta.name.toLowerCase(), colMeta);
      resolved.push(colMeta.name);
    }
    console.log(`  ${id} -> ${key}: ${resolved.length ? resolved.join(', ') : '(no filter/group columns)'}`);
  }

  let created = 0;
  let skipped = 0;

  for (const [key, { schema, table, columns }] of wanted) {
    if (!columns.size) continue;
    console.log(`\n${key}`);
    const { leading, names } = await existingIndexes(schema, table);

    for (const colMeta of columns.values()) {
      const { skip, targets } = indexTargets(colMeta);
      if (skip) {
        console.log(`  - ${colMeta.name}: ${skip}`);
        skipped += 1;
        continue;
      }

      for (const target of targets!) {
        const name = indexName(table, colMeta.name, target.suffix);

        if (!target.suffix && leading.has(colMeta.name.toLowerCase())) {
          console.log(`  = ${colMeta.name}: already the leading column of an index`);
          skipped += 1;
          continue;
        }
        if (names.has(name)) {
          console.log(`  = ${name}: already exists`);
          skipped += 1;
          continue;
        }

        const sql =
          `CREATE INDEX ${quoteIdentifier(name)} ON ${quoteQualified(schema, table)} (${target.expr})`;
        if (dryRun) {
          console.log(`  ~ ${sql}   -- ${target.note}`);
        } else {
          await db.query(sql);
          console.log(`  + ${name} on ${colMeta.name} (${target.note})`);
        }
        created += 1;
      }
    }
  }

  console.log(`\n${dryRun ? 'Would create' : 'Created'}: ${created}, skipped: ${skipped}`);
  await db.end();
})().catch((e: any) => {
  console.error('ERROR', e.message);
  process.exit(1);
});
