import crypto from 'node:crypto';
import config from '../src/config';
import { bootstrapAppMeta } from '../src/modules/system/bootstrapService';
import { accessLevelId, systemRoleId } from '../src/modules/catalogue/catalogueService';
import { hashToken } from '../src/shared/security/hash';
import { hashPassword } from '../src/shared/security/password';
import { displayPrefix, newTokenValue } from '../src/modules/mcp/mcpTokenFormat';

const BASE = process.env.E2E_BASE || 'http://localhost:8099';
const { db, prisma } = config.database;
const DAY_MS = 24 * 60 * 60 * 1000;
const PASSWORD = 'McpE2e-Passw0rd!';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: unknown, detail?: unknown): void {
  const note =
    detail === undefined || detail === null
      ? ''
      : ` -- ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failures.push(name + note);
    console.log(`  FAIL  ${name}${note}`);
  }
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

interface Reply {
  status: number;
  body: any;
  headers: Headers;
}

async function call(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown
): Promise<Reply> {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, body: json, headers: res.headers };
}

function bearer(token: string, path: string, extra: Record<string, string> = {}): Promise<Reply> {
  return call('GET', path, { Authorization: `Bearer ${token}`, ...extra });
}

function session() {
  const cookies = new Map<string, string>();
  return {
    headers(csrf = true): Record<string, string> {
      const out: Record<string, string> = {};
      if (cookies.size) out.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
      const token = cookies.get('da_csrf');
      if (csrf && token) out['X-CSRF-Token'] = token;
      return out;
    },
    async send(method: string, path: string, body?: unknown, { csrf = true } = {}): Promise<Reply> {
      const res = await fetch(BASE + path, {
        method,
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...this.headers(csrf) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const line of res.headers.getSetCookie()) {
        const [pair] = line.split(';');
        const at = pair.indexOf('=');
        const value = pair.slice(at + 1).trim();
        if (value) cookies.set(pair.slice(0, at).trim(), value);
        else cookies.delete(pair.slice(0, at).trim());
      }
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
    },
  };
}

const made = { companies: [] as string[], platformUsers: [] as string[] };

async function makeCompany(name: string, { active = true } = {}): Promise<string> {
  const { rows } = await db.query(`INSERT INTO companies (name, slug, active) VALUES (?, ?, ?) RETURNING id`, [
    name,
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    active,
  ]);
  const id = rows[0].id;
  made.companies.push(id);
  await db.query(
    `INSERT INTO access_control.company_features (company_id, feature_ids)
     SELECT ?::uuid, COALESCE(array_agg(id), '{}') FROM access_control.features`,
    [id]
  );
  return id;
}

async function makeUser(
  companyId: string | null,
  username: string,
  role: 'USER' | 'COMPANY_ADMIN' | 'PLATFORM_ADMIN',
  { status = 'active', mustChangePassword = false } = {}
): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO users (company_id, username, email, password_hash, status, must_change_password)
     VALUES (?, ?, ?, ?, ?::user_status, ?) RETURNING id`,
    [companyId, username, `${username}@example.com`, hashPassword(PASSWORD), status, mustChangePassword]
  );
  await db.query(`INSERT INTO access_control.user_roles (user_id, role_id) VALUES (?, ?)`, [
    rows[0].id,
    systemRoleId(role),
  ]);
  if (companyId === null) made.platformUsers.push(rows[0].id);
  return rows[0].id;
}

async function issueToken(userId: string, { expiresAt = new Date(Date.now() + 30 * DAY_MS) } = {}) {
  const token = newTokenValue();
  const row = await prisma.mcpToken.create({
    data: {
      id: crypto.randomUUID(),
      userId,
      name: 'e2e',
      tokenPrefix: displayPrefix(token),
      tokenHash: hashToken(token),
      expiresAt,
    },
  });
  return { token, id: row.id };
}

async function makeConnection(
  companyId: string | null,
  name: string,
  createdBy: string,
  { generalAccess = 'restricted', deleted = false } = {}
): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO connections (id, company_id, provider, name, host, secret, secret_hint, created_by, general_access, deleted_at)
     VALUES (gen_random_uuid(), ?, 'domo', ?, 'acme.domo.com', 'sealed', '…abcd', ?, ?::general_access, ?)
     RETURNING id`,
    [companyId, name, createdBy, generalAccess, deleted ? new Date() : null]
  );
  return rows[0].id;
}

const fact = (objectType: string, qualifiedName: string, payload: Record<string, unknown>) => ({
  id: crypto.randomUUID(),
  objectType,
  qualifiedName,
  sourceType: 'db_inferred',
  confidence: 0.9,
  payload,
  edited: false,
});

const SNAPSHOT = [
  fact('table', 'sales.orders', { description: 'One row per online order.', row_count: 1000 }),
  fact('column_stats', 'sales.orders.amount', { data_type: 'number', description: 'Order total in EUR.' }),
  fact('column_stats', 'sales.orders.customer_id', { data_type: 'string' }),
  fact('table', 'sales.customers', { description: 'Every customer who ever ordered.' }),
  fact('join', 'sales.orders.customer_id=sales.customers.id', {
    left: 'sales.orders',
    right: 'sales.customers',
    note: 'Many orders per customer.',
  }),
  fact('metric', 'Revenue', { definition: 'SUM(sales.orders.amount) over completed orders.' }),
  fact('glossary', 'Churn', { definition: 'A customer with no order in 90 days.' }),
  fact('example', 'Top customers', { sql: 'SELECT customer_id FROM sales.orders ORDER BY amount DESC' }),
];

async function publish(
  connectionId: string,
  companyId: string | null,
  name: string,
  version: number,
  publishedBy: string,
  { deleted = false, snapshot = SNAPSHOT } = {}
): Promise<string> {
  const counts: Record<string, number> = {};
  for (const f of snapshot) counts[f.objectType] = (counts[f.objectType] || 0) + 1;
  const { rows } = await db.query(
    `INSERT INTO context_layer_versions
       (id, connection_id, company_id, name, version, status, snapshot, datasets, stats, business_layer,
        object_count, published_by, published_at, created_by, deleted_at)
     VALUES (gen_random_uuid(), ?, ?, ?, ?, 'published', ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, ?, ?, now() - (?::int * interval '1 hour'), ?, ?)
     RETURNING id`,
    [
      connectionId,
      companyId,
      name,
      version,
      JSON.stringify(snapshot),
      JSON.stringify([{ id: 'ds-orders', name: 'sales.orders', rowCount: 1000, columnCount: 5 }]),
      JSON.stringify({ counts, tables: ['sales.customers', 'sales.orders'] }),
      JSON.stringify({ tables: { 'ds-orders': 'Every order placed online, refreshed nightly.' } }),
      snapshot.length,
      publishedBy,
      10 - version,
      publishedBy,
      deleted ? new Date() : null,
    ]
  );
  return rows[0].id;
}

async function grantUser(connectionId: string, userId: string, level: string, by: string): Promise<void> {
  await db.query(
    `INSERT INTO access_control.context_user_access (connection_id, user_id, access_level_id, granted_by) VALUES (?, ?, ?, ?)`,
    [connectionId, userId, accessLevelId('context', level), by]
  );
}

const names = (reply: Reply): string[] => (reply.body?.data?.items ?? []).map((c: any) => c.name).sort();
const path = (connectionId: string, name: string, rest = '') =>
  `/api/mcp/data/contexts/${connectionId}/${encodeURIComponent(name)}${rest}`;

async function cleanup(): Promise<void> {
  for (const id of made.companies) await db.query('DELETE FROM companies WHERE id = ?', [id]);
  for (const id of made.platformUsers) {
    await db.query('DELETE FROM connections WHERE created_by = ?', [id]);
    await db.query('DELETE FROM users WHERE id = ?', [id]);
  }
}

(async () => {
  await bootstrapAppMeta();

  const companyA = await makeCompany('Mcp E2e Alpha');
  const companyB = await makeCompany('Mcp E2e Beta');
  const companyOff = await makeCompany('Mcp E2e Dormant', { active: false });
  const companyBare = await makeCompany('Mcp E2e Bare');

  const adminA = await makeUser(companyA, 'mcpe2e.admin', 'COMPANY_ADMIN');
  const creatorA = await makeUser(companyA, 'mcpe2e.creator', 'USER');
  const sharedA = await makeUser(companyA, 'mcpe2e.shared', 'USER');
  const groupieA = await makeUser(companyA, 'mcpe2e.groupie', 'USER');
  const plainA = await makeUser(companyA, 'mcpe2e.plain', 'USER');
  const disabledA = await makeUser(companyA, 'mcpe2e.disabled', 'USER', { status: 'disabled' });
  const pendingA = await makeUser(companyA, 'mcpe2e.pending', 'USER', { status: 'pending' });
  const changeA = await makeUser(companyA, 'mcpe2e.change', 'USER', { mustChangePassword: true });
  const memberB = await makeUser(companyB, 'mcpe2e.beta', 'USER');
  const memberOff = await makeUser(companyOff, 'mcpe2e.dormant', 'USER');
  const memberBare = await makeUser(companyBare, 'mcpe2e.bare', 'USER');
  const platform = await makeUser(null, 'mcpe2e.platform', 'PLATFORM_ADMIN');
  const { rows: bareRole } = await db.query(
    `INSERT INTO access_control.roles (id, company_id, kind, tier, name)
     VALUES (gen_random_uuid(), ?, 'custom', 'USER', 'Viewer without lakehouse') RETURNING id`,
    [companyBare]
  );
  await db.query(`INSERT INTO access_control.role_permissions (role_id, permission_ids) VALUES (?, '{}')`, [
    bareRole[0].id,
  ]);
  await db.query(`UPDATE access_control.user_roles SET role_id = ? WHERE user_id = ?`, [bareRole[0].id, memberBare]);

  const restricted = await makeConnection(companyA, 'Sales warehouse', creatorA);
  await publish(restricted, companyA, 'Sales', 1, creatorA);
  await publish(restricted, companyA, 'Sales', 2, creatorA, { deleted: true });
  await publish(restricted, companyA, 'Sales', 3, creatorA);
  await publish(restricted, companyA, 'Second', 1, creatorA, { snapshot: SNAPSHOT.slice(0, 2) });
  await grantUser(restricted, sharedA, 'view', creatorA);
  await grantUser(restricted, disabledA, 'view', creatorA);
  await grantUser(restricted, pendingA, 'view', creatorA);
  await grantUser(restricted, changeA, 'view', creatorA);
  const { rows: groupRows } = await db.query(
    `INSERT INTO groups (company_id, name, active) VALUES (?, 'Analysts', TRUE) RETURNING id`,
    [companyA]
  );
  await db.query(`INSERT INTO group_users (group_id, user_id) VALUES (?, ?)`, [groupRows[0].id, groupieA]);
  await db.query(
    `INSERT INTO access_control.context_group_access (connection_id, group_id, access_level_id, granted_by) VALUES (?, ?, ?, ?)`,
    [restricted, groupRows[0].id, accessLevelId('context', 'edit'), creatorA]
  );

  const odd = 'Revenue & Orders / EU 100%';
  const companyWide = await makeConnection(companyA, 'Finance', adminA, { generalAccess: 'company' });
  await publish(companyWide, companyA, odd, 1, adminA);

  const platformCtx = await makeConnection(null, 'Benchmarks', platform);
  await publish(platformCtx, null, 'Industry', 1, platform);
  await db.query(
    `INSERT INTO access_control.context_company_access (connection_id, company_id, access_level_id, granted_by) VALUES (?, ?, ?, ?)`,
    [platformCtx, companyB, accessLevelId('context', 'view'), platform]
  );

  const gone = await makeConnection(companyA, 'Old', adminA, { generalAccess: 'company', deleted: true });
  await publish(gone, companyA, 'Retired', 1, adminA);

  const betaCtx = await makeConnection(companyB, 'Beta data', memberB, { generalAccess: 'company' });
  await publish(betaCtx, companyB, 'Beta', 1, memberB);

  const tokens = {
    admin: await issueToken(adminA),
    creator: await issueToken(creatorA),
    shared: await issueToken(sharedA),
    groupie: await issueToken(groupieA),
    plain: await issueToken(plainA),
    disabled: await issueToken(disabledA),
    pending: await issueToken(pendingA),
    change: await issueToken(changeA),
    beta: await issueToken(memberB),
    dormant: await issueToken(memberOff),
    bare: await issueToken(memberBare),
    platform: await issueToken(platform),
    expired: await issueToken(sharedA, { expiresAt: new Date(Date.now() - DAY_MS) }),
  };

  section('Who sees which contexts');

  const list = async (token: string) => bearer(token, '/api/mcp/data/contexts');
  const all = ['Beta', 'Industry', odd, 'Sales', 'Second'].sort();
  const expectations: [string, string, string[]][] = [
    ['a company admin sees every context of the company', tokens.admin.token, [odd, 'Sales', 'Second']],
    ['the creator sees their own and the company-wide one', tokens.creator.token, [odd, 'Sales', 'Second']],
    ['a direct share opens every name on the connection', tokens.shared.token, [odd, 'Sales', 'Second']],
    ['a group share counts', tokens.groupie.token, [odd, 'Sales', 'Second']],
    ['a member with no share sees only the company-wide context', tokens.plain.token, [odd]],
    ['another company sees its own and the platform context shared with it', tokens.beta.token, ['Beta', 'Industry']],
    ['a platform account sees every live context, never a deleted one', tokens.platform.token, all],
  ];
  for (const [label, token, expected] of expectations) {
    const reply = await list(token);
    check(label, reply.status === 200 && names(reply).join('|') === expected.sort().join('|'), {
      status: reply.status,
      names: names(reply),
    });
  }

  const listed = await list(tokens.shared.token);
  const sales = listed.body.data.items.find((c: any) => c.name === 'Sales');
  check(
    'a context is listed at its live version, deleted versions not counted',
    sales?.liveVersion === 3 && sales?.versionCount === 2 && sales?.connectionId === restricted,
    sales
  );
  check(
    'the summary carries counts and dataset count',
    sales?.counts?.metric === 1 && sales?.datasetCount === 1 && sales?.objectCount === SNAPSHOT.length,
    sales
  );
  check('a direct view share reads as view', sales?.access === 'view', sales?.access);
  const groupieSales = (await list(tokens.groupie.token)).body.data.items.find((c: any) => c.name === 'Sales');
  check('a group edit share reads as edit', groupieSales?.access === 'edit', groupieSales?.access);
  const adminSales = (await list(tokens.admin.token)).body.data.items.find((c: any) => c.name === 'Sales');
  check('a company admin has full access', adminSales?.access === 'full', adminSales?.access);

  const paged = await bearer(tokens.platform.token, '/api/mcp/data/contexts?limit=2');
  check(
    'listing pages with a cursor',
    paged.body?.data?.items?.length === 2 &&
      paged.body.data.total === 5 &&
      typeof paged.body.data.nextCursor === 'string',
    paged.body?.data
  );
  const page2 = await bearer(
    tokens.platform.token,
    `/api/mcp/data/contexts?limit=2&cursor=${paged.body.data.nextCursor}`
  );
  const page3 = await bearer(
    tokens.platform.token,
    `/api/mcp/data/contexts?limit=2&cursor=${page2.body.data.nextCursor}`
  );
  const walked = [...paged.body.data.items, ...page2.body.data.items, ...page3.body.data.items].map((c: any) => c.name);
  check(
    'walking the cursor visits every context once and ends with null',
    walked.sort().join('|') === all.join('|') && page3.body.data.nextCursor === null,
    walked
  );
  const searched = await bearer(tokens.platform.token, '/api/mcp/data/contexts?q=bench');
  check('q matches the connection name too', names(searched).join('|') === 'Industry', names(searched));
  const badCursor = await bearer(tokens.platform.token, '/api/mcp/data/contexts?cursor=nonsense');
  check('a cursor the API did not issue is 400', badCursor.status === 400, badCursor.status);
  const bigLimit = await bearer(tokens.platform.token, '/api/mcp/data/contexts?limit=500');
  check('a limit above 100 is 400', bigLimit.status === 400, bigLimit.status);

  section('One context');

  const overview = await bearer(tokens.shared.token, path(restricted, 'Sales'));
  const ov = overview.body?.data;
  check('the overview reads the live version', overview.status === 200 && ov.version === 3 && ov.isLive === true, ov);
  check(
    'datasets carry the business overview',
    ov?.datasets?.[0]?.overview === 'Every order placed online, refreshed nightly.' && ov.datasets[0].rowCount === 1000,
    ov?.datasets
  );
  check('the table list comes from the stats', ov?.tables?.join('|') === 'sales.customers|sales.orders', ov?.tables);

  const v1 = await bearer(tokens.shared.token, path(restricted, 'Sales', '?version=v1'));
  check('an older version can be pinned', v1.body?.data?.version === 1 && v1.body.data.isLive === false, v1.body?.data);
  const v2 = await bearer(tokens.shared.token, path(restricted, 'Sales', '?version=2'));
  check(
    'a deleted version is 404 with its own message',
    v2.status === 404 && /Version 2 of this context is not published/.test(v2.body?.error?.message),
    v2.body
  );
  const v9 = await bearer(tokens.shared.token, path(restricted, 'Sales', '?version=9'));
  check('a version that never existed is 404', v9.status === 404, v9.status);
  const vBad = await bearer(tokens.shared.token, path(restricted, 'Sales', '?version=latest'));
  check('a version that is not a number is 400', vBad.status === 400, vBad.status);

  const versions = await bearer(tokens.shared.token, path(restricted, 'Sales', '/versions'));
  check(
    'versions list the published ones newest first and mark the live one',
    versions.body?.data?.items?.map((v: any) => `${v.label}${v.live ? '*' : ''}`).join(',') === 'v3*,v1',
    versions.body?.data
  );

  const oddOverview = await bearer(tokens.plain.token, path(companyWide, odd));
  check(
    'a name with &, / and % works once URL-encoded',
    oddOverview.status === 200 && oddOverview.body.data.name === odd,
    oddOverview.body
  );

  const plainPeek = await bearer(tokens.plain.token, path(restricted, 'Sales'));
  check(
    'a context that is not shared with you is 404',
    plainPeek.status === 404 && plainPeek.body?.error?.message === 'Context not found.',
    plainPeek.body
  );
  const plainVersionPeek = await bearer(tokens.plain.token, path(restricted, 'Sales', '?version=2'));
  check(
    'asking for a version does not reveal a context you cannot read',
    plainVersionPeek.body?.error?.message === 'Context not found.',
    plainVersionPeek.body
  );
  const crossCompany = await bearer(tokens.beta.token, path(restricted, 'Sales'));
  check('another company gets 404', crossCompany.status === 404, crossCompany.status);
  const platformShared = await bearer(tokens.beta.token, path(platformCtx, 'Industry'));
  check(
    'a platform context shared with the company is readable',
    platformShared.status === 200 &&
      platformShared.body.data.access === 'view' &&
      platformShared.body.data.company === null,
    platformShared.body?.data
  );
  const platformNotShared = await bearer(tokens.admin.token, path(platformCtx, 'Industry'));
  check('a company admin cannot read an unshared platform context', platformNotShared.status === 404);
  const deletedConnection = await bearer(tokens.platform.token, path(gone, 'Retired'));
  check('a deleted connection is 404 even for a platform account', deletedConnection.status === 404);
  const malformed = await bearer(tokens.platform.token, path('not-a-uuid', 'Sales'));
  check('a malformed connection id is 404', malformed.status === 404, malformed.status);

  section('Facts');

  const objects = await bearer(tokens.shared.token, path(restricted, 'Sales', '/objects'));
  check(
    'objects returns every approved fact of the live version',
    objects.body?.data?.total === SNAPSHOT.length && objects.body.data.version === 3,
    objects.body?.data?.total
  );
  const metrics = await bearer(tokens.shared.token, path(restricted, 'Sales', '/objects?type=metric'));
  check(
    'type narrows to one kind of fact',
    metrics.body?.data?.items?.map((e: any) => e.qualifiedName).join('|') === 'Revenue',
    metrics.body?.data
  );
  const two = await bearer(tokens.shared.token, path(restricted, 'Sales', '/objects?type=metric,glossary'));
  check('several types are comma-separated', two.body?.data?.total === 2, two.body?.data?.total);
  const badType = await bearer(tokens.shared.token, path(restricted, 'Sales', '/objects?type=secrets'));
  check('an unknown type is 400', badType.status === 400, badType.status);
  const search = await bearer(tokens.shared.token, path(restricted, 'Sales', '/objects?q=customer'));
  const searchNames = search.body?.data?.items?.map((e: any) => e.qualifiedName) ?? [];
  check(
    'q matches names and payload text, name matches first',
    searchNames.length >= 3 && searchNames.slice(0, 2).every((n: string) => n.includes('customer')),
    searchNames
  );
  const allWords = await bearer(tokens.shared.token, path(restricted, 'Sales', '/objects?q=customer%20ninety'));
  check('every word of q must match', allWords.body?.data?.total === 0, allWords.body?.data?.total);
  const exact = await bearer(tokens.shared.token, path(restricted, 'Sales', '/objects?qualifiedName=Churn'));
  check(
    'qualifiedName finds one fact exactly',
    exact.body?.data?.total === 1 && exact.body.data.items[0].payload.definition.includes('90 days'),
    exact.body?.data
  );
  const firstPage = await bearer(tokens.shared.token, path(restricted, 'Sales', '/objects?limit=3'));
  const secondPage = await bearer(
    tokens.shared.token,
    path(restricted, 'Sales', `/objects?limit=3&cursor=${firstPage.body.data.nextCursor}`)
  );
  const pagedIds = [...firstPage.body.data.items, ...secondPage.body.data.items].map((e: any) => e.id);
  check('objects page without repeats', new Set(pagedIds).size === 6, pagedIds.length);
  const older = await bearer(tokens.shared.token, path(restricted, 'Second', '/objects'));
  check('each name keeps its own snapshot', older.body?.data?.total === 2, older.body?.data?.total);

  section('One table');

  const table = await bearer(tokens.shared.token, path(restricted, 'Sales', '/table?qualifiedName=sales.orders'));
  const t = table.body?.data;
  check(
    'describe_table returns the table fact',
    table.status === 200 && t.table.qualifiedName === 'sales.orders',
    table.body
  );
  check(
    'with its columns',
    t?.columns
      ?.map((c: any) => c.qualifiedName)
      .sort()
      .join('|') === 'sales.orders.amount|sales.orders.customer_id',
    t?.columns
  );
  check(
    'and every fact that mentions it',
    ['Revenue', 'Top customers', 'sales.orders.customer_id=sales.customers.id'].every((n) =>
      t?.related?.some((r: any) => r.qualifiedName === n)
    ),
    t?.related?.map((r: any) => r.qualifiedName)
  );
  check(
    'and the dataset with its business overview',
    t?.dataset?.id === 'ds-orders' && t.dataset.overview === 'Every order placed online, refreshed nightly.',
    t?.dataset
  );
  const upper = await bearer(tokens.shared.token, path(restricted, 'Sales', '/table?qualifiedName=SALES.ORDERS'));
  check('the table name is matched case-insensitively as a fallback', upper.status === 200, upper.status);
  const missingTable = await bearer(
    tokens.shared.token,
    path(restricted, 'Sales', '/table?qualifiedName=sales.refunds')
  );
  check('an unknown table is 404', missingTable.status === 404, missingTable.status);
  const noName = await bearer(tokens.shared.token, path(restricted, 'Sales', '/table'));
  check('the table name is required', noName.status === 400, noName.status);

  section('Refused tokens');

  const challengeOf = (reply: Reply) => reply.headers.get('www-authenticate') ?? '';
  const none = await call('GET', '/api/mcp/data/contexts');
  check(
    'no token is 401 with a bare Bearer challenge',
    none.status === 401 && challengeOf(none) === 'Bearer realm="elze-mcp"',
    challengeOf(none)
  );
  const junk = await bearer('not-a-token', '/api/mcp/data/contexts');
  check(
    'a malformed token is 401 invalid_token',
    junk.status === 401 && challengeOf(junk).includes('error="invalid_token"'),
    challengeOf(junk)
  );
  const unknown = await bearer(newTokenValue(), '/api/mcp/data/contexts');
  check('an unknown token is 401', unknown.status === 401, unknown.status);
  const lower = await call('GET', '/api/mcp/data/contexts', { Authorization: `bearer ${tokens.shared.token}` });
  check('the Bearer scheme is case-insensitive', lower.status === 200, lower.status);

  const refusals: [string, string, RegExp][] = [
    ['an expired token is 401', tokens.expired.token, /expired/],
    ['a disabled account is 401', tokens.disabled.token, /deactivated/],
    ['a pending account is 401', tokens.pending.token, /not been activated/],
    ['an account in an inactive company is 401', tokens.dormant.token, /company/],
    ['an account that must change its password is 401', tokens.change.token, /new password/],
  ];
  for (const [label, token, message] of refusals) {
    const reply = await bearer(token, '/api/mcp/data/contexts');
    check(
      label,
      reply.status === 401 && reply.body?.error?.code === 'UNAUTHENTICATED' && message.test(reply.body.error.message),
      reply.body
    );
  }
  const bare = await bearer(tokens.bare.token, '/api/mcp/data/contexts');
  check('an account without context.read is 403', bare.status === 403, bare.body);

  section('Real token flow and the cookie routes');

  const web = session();
  const login = await web.send('POST', '/api/auth/login', { identifier: 'mcpe2e.shared', password: PASSWORD });
  check('the member signs in with the cookie session', login.status === 200, login.body);
  const me = await web.send('GET', '/api/auth/me');
  check('the cookie session still works on a cookie route', me.status === 200, me.status);
  const noCsrf = await web.send('POST', '/api/mcp/tokens', { name: 'No CSRF' }, { csrf: false });
  check(
    'creating a token still needs the CSRF header',
    noCsrf.status === 403 && noCsrf.body?.error?.code === 'CSRF_TOKEN_INVALID',
    noCsrf.body
  );
  const created = await web.send('POST', '/api/mcp/tokens', { name: 'Claude Desktop', expiresInDays: 30 });
  const issued = created.body?.data;
  check(
    'the member creates a token over HTTP and it is not cached',
    created.status === 201 && /^elze_pat_/.test(issued?.token) && created.headers.get('cache-control') === 'no-store',
    created.body
  );
  const used = await bearer(issued.token, '/api/mcp/data/contexts');
  check('the new token reads contexts', used.status === 200 && names(used).includes('Sales'), used.status);
  check('every MCP answer carries the per-token rate limit', Boolean(used.headers.get('ratelimit-policy')));
  const who = await bearer(issued.token, '/api/mcp/data/session');
  check(
    'session names the token owner and the token, never the token itself',
    who.status === 200 &&
      who.body.data.user.id === sharedA &&
      who.body.data.token.id === issued.id &&
      who.body.data.token.prefix === issued.prefix &&
      !JSON.stringify(who.body).includes(issued.token.slice(16)),
    who.body
  );
  const touched = await prisma.mcpToken.findUnique({ where: { id: issued.id }, select: { lastUsedAt: true } });
  check('using a token records when it was last used', touched?.lastUsedAt instanceof Date, touched);

  const cookieOnData = await web.send('GET', '/api/mcp/data/contexts');
  check('the session cookie is not accepted on /api/mcp/data', cookieOnData.status === 401, cookieOnData.status);
  const tokenOnCookieRoute = await bearer(issued.token, '/api/context/connections');
  check(
    'a personal MCP token is not accepted on a cookie route',
    tokenOnCookieRoute.status === 401 && tokenOnCookieRoute.body?.error?.code === 'UNAUTHENTICATED',
    tokenOnCookieRoute.body
  );
  const access = await web.send('GET', `/api/context/connections/${restricted}/mcp?name=Sales`);
  check(
    'the MCP details name the live version of the requested context',
    access.status === 200 && access.body.data.context.name === 'Sales' && access.body.data.context.version === 'v3',
    access.body?.data?.context
  );
  check(
    'and list the new tools',
    access.body?.data?.tools?.some((tool: any) => tool.name === 'describe_table'),
    access.body?.data?.tools?.map((tool: any) => tool.name)
  );

  const revoke = await web.send('DELETE', `/api/mcp/tokens/${issued.id}`);
  check('the member revokes the token', revoke.status === 200 && revoke.body.data.status === 'revoked', revoke.body);
  const afterRevoke = await bearer(issued.token, '/api/mcp/data/contexts');
  check(
    'the next call with it is 401 at once',
    afterRevoke.status === 401 && /revoked/.test(afterRevoke.body?.error?.message),
    afterRevoke.body
  );

  section('Audit trail');

  await new Promise((resolve) => setTimeout(resolve, 600));
  const trail = await db.query(
    `SELECT detail->>'reason' AS reason, detail->>'tokenId' AS token_id, detail::text AS detail
       FROM audit_logs WHERE event = 'mcp_token_rejected'`
  );
  const reasons = new Set(trail.rows.map((r: any) => r.reason));
  check(
    'known tokens that are refused are audited with the reason',
    ['revoked', 'expired', 'account_disabled', 'account_pending', 'company_disabled', 'password_change_required'].every(
      (r) => reasons.has(r)
    ),
    [...reasons]
  );
  check(
    'no rejection entry holds a token',
    trail.rows.every((r: any) => Object.values(tokens).every((t) => !r.detail.includes(t.token.slice(16))))
  );
  const again = await bearer(tokens.expired.token, '/api/mcp/data/contexts');
  await new Promise((resolve) => setTimeout(resolve, 300));
  const expiredEntries = await db.query(
    `SELECT COUNT(*)::int AS n FROM audit_logs WHERE event = 'mcp_token_rejected' AND detail->>'tokenId' = ?`,
    [tokens.expired.id]
  );
  check(
    'a token refused again within 10 minutes is not audited twice',
    again.status === 401 && expiredEntries.rows[0].n === 1,
    expiredEntries.rows[0].n
  );

  await cleanup();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  await db.end?.();
  process.exit(failed ? 1 : 0);
})().catch(async (err: unknown) => {
  console.error('\nHARNESS ERROR:', err);
  try {
    await cleanup();
  } catch {}
  process.exit(1);
});
