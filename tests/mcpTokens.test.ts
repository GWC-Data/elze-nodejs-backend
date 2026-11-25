import config from '../src/config';
import { bootstrapAppMeta } from '../src/modules/system/bootstrapService';
import { systemRoleId } from '../src/modules/catalogue/catalogueService';
import { hashToken } from '../src/shared/security/hash';
import * as tokens from '../src/modules/mcp/mcpTokenService';
import type { Actor } from '../src/shared/types/actor';

const { db, prisma } = config.database;

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: unknown, detail?: unknown): void {
  const note = detail === undefined || detail === null ? '' : ` -- ${String(detail)}`;
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

async function codeOf(work: () => unknown): Promise<string | null> {
  try {
    await work();
    return null;
  } catch (err: any) {
    return err.code || err.name || 'UNKNOWN';
  }
}

const REFUSED = new Set(['INSUFFICIENT_PERMISSION', 'FEATURE_NOT_ENABLED']);
const DAY_MS = 24 * 60 * 60 * 1000;
const MEMBER_PERMISSIONS = ['context.read'];
const ADMIN_PERMISSIONS = ['context.read', 'context.manage_all', 'user.read', 'user.update', 'user.deactivate'];

const made: { companies: string[]; platformUsers: string[] } = { companies: [], platformUsers: [] };
const issued: string[] = [];

async function makeCompany(name: string): Promise<string> {
  const { rows } = await db.query(`INSERT INTO companies (name, slug, active) VALUES (?, ?, TRUE) RETURNING id`, [
    name,
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  ]);
  made.companies.push(rows[0].id);
  return rows[0].id;
}

async function makeUser(
  companyId: string | null,
  username: string,
  role: 'USER' | 'COMPANY_ADMIN' | 'PLATFORM_ADMIN',
  permissions: string[],
  { isDefaultAdmin = false }: { isDefaultAdmin?: boolean } = {}
): Promise<Actor> {
  const { rows } = await db.query(
    `INSERT INTO users (company_id, username, email, password_hash, status)
     VALUES (?, ?, ?, 'x', 'active') RETURNING id`,
    [companyId, username, `${username}@example.com`]
  );
  await db.query(`INSERT INTO access_control.user_roles (user_id, role_id) VALUES (?, ?)`, [
    rows[0].id,
    systemRoleId(role),
  ]);
  if (companyId === null) made.platformUsers.push(rows[0].id);
  return {
    id: rows[0].id,
    username,
    email: `${username}@example.com`,
    displayName: null,
    companyId,
    isPlatform: companyId === null,
    isDefaultAdmin,
    role,
    roleScope: companyId === null ? 'platform' : 'company',
    status: 'active',
    mustChangePassword: false,
    permissions,
    features: [],
    roleId: null,
    roleName: null,
  } as Actor;
}

async function issue(actor: Actor, name: string, expiresInDays?: number) {
  const token = await tokens.createToken(actor, { name, ...(expiresInDays === undefined ? {} : { expiresInDays }) });
  issued.push(token.token);
  return token;
}

async function rowOf(id: string) {
  const { rows } = await db.query(
    `SELECT token_hash, token_prefix, revoked_at, revoked_by, revoked_reason, row_to_json(t)::text AS whole
       FROM mcp_tokens t WHERE id = ?::uuid`,
    [id]
  );
  return rows[0];
}

async function cleanup(): Promise<void> {
  for (const id of made.companies) await db.query('DELETE FROM companies WHERE id = ?', [id]);
  for (const id of made.platformUsers) await db.query('DELETE FROM users WHERE id = ?', [id]);
}

(async () => {
  await bootstrapAppMeta();

  const companyA = await makeCompany('Mcp Alpha');
  const companyB = await makeCompany('Mcp Beta');
  const defaultAdminA = await makeUser(companyA, 'mcp.alpha.owner', 'COMPANY_ADMIN', ADMIN_PERMISSIONS, {
    isDefaultAdmin: true,
  });
  const adminA = await makeUser(companyA, 'mcp.alpha.admin', 'COMPANY_ADMIN', ADMIN_PERMISSIONS);
  const memberA = await makeUser(companyA, 'mcp.alpha.member', 'USER', MEMBER_PERMISSIONS);
  const otherMemberA = await makeUser(companyA, 'mcp.alpha.other', 'USER', MEMBER_PERMISSIONS);
  const readerlessA = await makeUser(companyA, 'mcp.alpha.readerless', 'USER', []);
  const adminB = await makeUser(companyB, 'mcp.beta.admin', 'COMPANY_ADMIN', ADMIN_PERMISSIONS);
  const platform = await makeUser(null, 'mcp.platform', 'PLATFORM_ADMIN', ADMIN_PERMISSIONS);

  section('Creating a token');

  const before = Date.now();
  const first = await issue(memberA, '  Claude Desktop  ');
  check(
    'the token is elze_pat_ followed by 43 characters',
    /^elze_pat_[A-Za-z0-9_-]{43}$/.test(first.token),
    first.token
  );
  check('the name is trimmed', first.name === 'Claude Desktop', first.name);
  check('the prefix is its first 16 characters', first.prefix === first.token.slice(0, 16), first.prefix);
  check('a new token is active with the read scope', first.status === 'active' && first.scope === 'mcp:read');
  const ninetyDays = new Date(first.expiresAt).getTime() - before;
  check(
    'it expires after 90 days by default',
    Math.abs(ninetyDays - 90 * DAY_MS) < 60_000,
    `${ninetyDays / DAY_MS} days`
  );
  check('it has never been used', first.lastUsedAt === null && first.revokedAt === null);

  const monthly = await issue(memberA, 'Cursor', 30);
  const thirtyDays = new Date(monthly.expiresAt).getTime() - Date.now();
  check('expiresInDays sets the expiry', Math.abs(thirtyDays - 30 * DAY_MS) < 60_000, `${thirtyDays / DAY_MS} days`);

  for (const days of [0, 366, 400, 1.5]) {
    const code = await codeOf(() => tokens.createToken(memberA, { name: 'x', expiresInDays: days }));
    check(`an expiry of ${days} days is refused, not clamped`, code === 'VALIDATION_ERROR', code);
  }
  const nameless = await codeOf(() => tokens.createToken(memberA, { expiresInDays: 30 }));
  check('a token needs a name', nameless === 'VALIDATION_ERROR', nameless);
  const readerless = await codeOf(() => tokens.createToken(readerlessA, { name: 'x' }));
  check('an account without context.read cannot create one', REFUSED.has(String(readerless)), readerless);

  section('Only the hash is stored');

  const stored = await rowOf(first.id);
  check('the stored hash is hashToken of the token', stored.token_hash === hashToken(first.token));
  check('the stored hash is not the token', stored.token_hash !== first.token);
  check('the stored prefix is the 16-character prefix', stored.token_prefix === first.prefix);
  check('the token appears nowhere in its row', !stored.whole.includes(first.token));
  const anywhere = await db.query(`SELECT COUNT(*)::int AS n FROM mcp_tokens t WHERE row_to_json(t)::text LIKE ?`, [
    `%${first.token.slice(16)}%`,
  ]);
  check('no row holds the secret part of any token', anywhere.rows[0].n === 0, anywhere.rows[0].n);

  section('Listing');

  const mine = await tokens.listTokens(memberA, undefined);
  const listed = JSON.stringify(mine);
  check('the list holds both tokens, newest first', mine.length === 2 && mine[0].id === monthly.id, mine.length);
  check('the list never carries the token', !listed.includes(first.token) && !listed.includes(monthly.token));
  check('the list never carries the hash', !listed.includes(stored.token_hash) && !/hash/i.test(listed));
  check(
    'each entry has exactly the documented fields',
    mine.every(
      (t) => Object.keys(t).sort().join() === 'createdAt,expiresAt,id,lastUsedAt,name,prefix,revokedAt,scope,status'
    ),
    Object.keys(mine[0]).join()
  );
  check('another account sees none of them', (await tokens.listTokens(otherMemberA, undefined)).length === 0);

  const adminView = await tokens.listTokens(adminA, memberA.id);
  check('a company admin lists a member’s tokens with userId', adminView.length === 2, adminView.length);
  const memberPeek = await codeOf(() => tokens.listTokens(otherMemberA, memberA.id));
  check('a member cannot list someone else’s tokens', REFUSED.has(String(memberPeek)), memberPeek);
  const otherCompanyPeek = await codeOf(() => tokens.listTokens(adminB, memberA.id));
  check('an admin of another company gets 404', otherCompanyPeek === 'RESOURCE_NOT_FOUND', otherCompanyPeek);
  const ownById = await tokens.listTokens(memberA, memberA.id.toUpperCase());
  check('naming yourself as userId lists your own tokens', ownById.length === 2, ownById.length);

  section('Revoking your own token');

  const revoked = await tokens.revokeToken(memberA, first.id);
  check('revoking returns it as revoked', revoked.status === 'revoked' && revoked.revokedAt !== null, revoked.status);
  const revokedRow = await rowOf(first.id);
  check(
    'the row records who revoked it and why',
    revokedRow.revoked_by === memberA.id && revokedRow.revoked_reason === 'revoked_by_owner',
    `${revokedRow.revoked_by} ${revokedRow.revoked_reason}`
  );
  const twice = await codeOf(() => tokens.revokeToken(memberA, first.id));
  check('revoking it twice is a conflict', twice === 'CONFLICT', twice);
  const unknown = await codeOf(() => tokens.revokeToken(memberA, '00000000-0000-4000-8000-000000000000'));
  check('an unknown id is 404', unknown === 'RESOURCE_NOT_FOUND', unknown);
  const malformed = await codeOf(() => tokens.revokeToken(memberA, 'not-a-uuid'));
  check('a malformed id is 404', malformed === 'RESOURCE_NOT_FOUND', malformed);

  section('Revoking someone else’s token');

  const memberGrab = await codeOf(() => tokens.revokeToken(otherMemberA, monthly.id));
  check(
    'a member cannot revoke a colleague’s token, and it looks unknown',
    memberGrab === 'RESOURCE_NOT_FOUND',
    memberGrab
  );
  const crossCompany = await codeOf(() => tokens.revokeToken(adminB, monthly.id));
  check('an admin of another company gets 404', crossCompany === 'RESOURCE_NOT_FOUND', crossCompany);
  check('the token survived both attempts', (await rowOf(monthly.id)).revoked_at === null);

  const byAdmin = await tokens.revokeToken(adminA, monthly.id);
  const byAdminRow = await rowOf(monthly.id);
  check(
    'a company admin revokes a member’s token',
    byAdmin.status === 'revoked' &&
      byAdminRow.revoked_by === adminA.id &&
      byAdminRow.revoked_reason === 'revoked_by_admin',
    `${byAdmin.status} ${byAdminRow.revoked_reason}`
  );

  const adminsToken = await issue(defaultAdminA, 'Owner laptop');
  const peerAdmin = await codeOf(() => tokens.revokeToken(adminA, adminsToken.id));
  check(
    'an admin who is not the default admin cannot revoke another admin’s token',
    peerAdmin === 'TENANT_ACCESS_DENIED',
    peerAdmin
  );
  const otherAdminsToken = await issue(adminA, 'Admin laptop');
  const byDefaultAdmin = await tokens.revokeToken(defaultAdminA, otherAdminsToken.id);
  check('the default admin revokes another admin’s token', byDefaultAdmin.status === 'revoked');

  const memberToken = await issue(memberA, 'VS Code');
  const byPlatform = await tokens.revokeToken(platform, memberToken.id);
  check('a platform admin revokes a company member’s token', byPlatform.status === 'revoked');

  section('The active-token cap');

  const capped: string[] = [];
  for (let i = 0; i < 10; i++) capped.push((await issue(otherMemberA, `Client ${i}`)).id);
  const eleventh = await codeOf(() => tokens.createToken(otherMemberA, { name: 'One too many' }));
  check('the 11th active token is refused', eleventh === 'CONFLICT', eleventh);
  await tokens.revokeToken(otherMemberA, capped[0]);
  const afterRevoke = await codeOf(() => issue(otherMemberA, 'Replacement'));
  check('revoking one makes room for another', afterRevoke === null, afterRevoke);
  await prisma.mcpToken.update({ where: { id: capped[1] }, data: { expiresAt: new Date(Date.now() - 60_000) } });
  const afterExpiry = await codeOf(() => issue(otherMemberA, 'After expiry'));
  check('an expired token no longer counts', afterExpiry === null, afterExpiry);
  const expiredEntry = (await tokens.listTokens(otherMemberA, undefined)).find((t) => t.id === capped[1]);
  check('an expired token is listed as expired', expiredEntry?.status === 'expired', expiredEntry?.status);

  section('Revoke all');

  const foreignAll = await codeOf(() => tokens.revokeAllTokens(memberA, { userId: otherMemberA.id }));
  check('a member cannot revoke a colleague’s tokens in bulk', REFUSED.has(String(foreignAll)), foreignAll);
  const crossAll = await codeOf(() => tokens.revokeAllTokens(adminB, { userId: otherMemberA.id }));
  check('an admin of another company gets 404 in bulk', crossAll === 'RESOURCE_NOT_FOUND', crossAll);

  const activeBefore = (await tokens.listTokens(otherMemberA, undefined)).filter((t) => t.status === 'active').length;
  const all = await tokens.revokeAllTokens(otherMemberA, undefined);
  check('revoke-all revokes every active token', all.revoked === activeBefore && activeBefore === 10, all.revoked);
  const left = await tokens.listTokens(otherMemberA, undefined);
  check(
    'none is active afterwards',
    left.every((t) => t.status !== 'active')
  );
  const expiredStill = left.find((t) => t.id === capped[1]);
  check('an already expired token is left as expired', expiredStill?.status === 'expired', expiredStill?.status);
  const again = await tokens.revokeAllTokens(otherMemberA, {});
  check('revoke-all with nothing active revokes nothing', again.revoked === 0, again.revoked);

  await issue(memberA, 'Bulk A');
  await issue(memberA, 'Bulk B');
  const adminAll = await tokens.revokeAllTokens(adminA, { userId: memberA.id });
  check('a company admin revokes all of a member’s tokens', adminAll.revoked === 2, adminAll.revoked);

  section('Audit trail');

  await new Promise((resolve) => setTimeout(resolve, 500));
  const trail = await db.query(
    `SELECT event, actor_id, target_user_id, detail::text AS detail FROM audit_logs
      WHERE event IN ('mcp_token_created', 'mcp_token_revoked') ORDER BY id`
  );
  const created = trail.rows.filter((r: any) => r.event === 'mcp_token_created');
  const revokedEvents = trail.rows.filter((r: any) => r.event === 'mcp_token_revoked');
  check(
    'every issued token was audited as created',
    created.length === issued.length,
    `${created.length}/${issued.length}`
  );
  check('every revocation was audited once, bulk ones as one entry', revokedEvents.length === 7, revokedEvents.length);
  check(
    'no audit entry holds a token',
    trail.rows.every((r: any) => issued.every((t) => !r.detail.includes(t.slice(16))))
  );
  const adminRevocation = revokedEvents.find(
    (r: any) => r.actor_id === adminA.id && r.target_user_id === memberA.id && r.detail.includes(monthly.id)
  );
  check('an admin revocation names the token holder as the target', Boolean(adminRevocation));

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
