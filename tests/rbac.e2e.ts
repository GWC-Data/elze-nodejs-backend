import { startSmtpSink } from './smtpSink';
import type { SmtpSink } from './smtpSink';
import { createReportingFixture } from './reportingFixture';
import config from '../src/config';
import {
  accessLevelId,
  featureIdsOf,
  loadCatalogue,
  permissionIdsOf,
  permissionKeysOf,
  systemRoleId,
} from '../src/modules/catalogue/catalogueService';

const pids = (...keys: string[]) => permissionIdsOf(keys);
const keysIn = (ids: unknown) => permissionKeysOf(Array.isArray(ids) ? ids : []);
const { APPLICATION_URL } = config.auth;
const { prisma } = config.database;

interface CallOptions {
  noAuth?: boolean;
  noCsrf?: boolean;
  csrf?: string;
  headers?: Record<string, string>;
}

interface CallResult {
  status: number;
  body: any;
}

const BASE = process.env.E2E_BASE || 'http://localhost:8099';
const SINK_PORT = Number(process.env.E2E_SMTP_PORT || 2525);

let sink: SmtpSink | null = null;

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: unknown, detail?: string | null): void {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failures.push(name + (detail ? ` -- ${detail}` : ''));
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

function client(label: string) {
  return {
    label,
    cookies: new Map<string, string>(),
    csrfToken: null as string | null | undefined,
    cookieHeader() {
      return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    absorb(res: Response) {
      const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const line of raw) {
        const [pair] = line.split(';');
        const idx = pair.indexOf('=');
        const name = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        if (value === '') this.cookies.delete(name);
        else this.cookies.set(name, value);
      }
      if (this.cookies.has('da_csrf')) this.csrfToken = this.cookies.get('da_csrf');
    },
    async call(method: string, url: string, body?: unknown, opts: CallOptions = {}): Promise<CallResult> {
      const headers: Record<string, string> = {};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (this.cookies.size && !opts.noAuth) headers.Cookie = this.cookieHeader();
      if (this.csrfToken && !opts.noCsrf) headers['X-CSRF-Token'] = this.csrfToken;
      if (opts.csrf) headers['X-CSRF-Token'] = opts.csrf;
      Object.assign(headers, opts.headers || {});

      const res = await fetch(BASE + url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      this.absorb(res);
      let json: any = null;
      const text = await res.text();
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
      }
      return { status: res.status, body: json };
    },
    adopt(_data?: unknown) {},
  };
}

function latestEmail(toAddress: string): string | null {
  const message = sink!.lastTo(toAddress);
  return message ? `${message.headers.subject || ''}\n${message.text}` : null;
}

function activationTokenFrom(email: string | null): string | null {
  const m = /\/activate\?token=([A-Za-z0-9_-]+)/.exec(email || '');
  return m ? m[1] : null;
}

function resetTokenFrom(email: string | null): string | null {
  const m = /\/reset-password\?token=([A-Za-z0-9_-]+)/.exec(email || '');
  return m ? m[1] : null;
}

function mailCount(toAddress: string): number {
  return sink!.messages.filter((m) => (m.headers.to || '').includes(toAddress)).length;
}

async function nextEmail(toAddress: string, after: number, timeoutMs = 5000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (mailCount(toAddress) > after) return latestEmail(toAddress);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

(async () => {
  await loadCatalogue();
  sink = await startSmtpSink({ port: SINK_PORT });
  console.log(`SMTP sink listening on 127.0.0.1:${SINK_PORT}`);

  const fixture = await createReportingFixture();
  console.log(`reporting fixture: ${fixture.schema}.${fixture.table}, ${fixture.rows} rows`);

  const boot = config.auth.bootstrapSuperAdmin();

  section('Platform owner: first sign-in requires a password change');

  const owner = client('owner');
  let r = await owner.call('POST', '/api/auth/login', {
    identifier: boot.username,
    password: boot.password,
  });
  check('login succeeds', r.status === 200, JSON.stringify(r.body));
  check('state is PASSWORD_CHANGE_REQUIRED', r.body?.data?.state === 'PASSWORD_CHANGE_REQUIRED');
  check(
    'response carries no token of any kind',
    !/token/i.test(Object.keys(r.body?.data || {}).join(',')),
    JSON.stringify(Object.keys(r.body?.data || {}))
  );
  check('refresh cookie was set', owner.cookies.has('da_refresh'));
  check('access cookie was set', owner.cookies.has('da_access'));
  owner.adopt(r.body.data);

  r = await owner.call('GET', '/api/platform/companies');
  check(
    'blocked from other endpoints until the change',
    r.status === 403 && r.body?.error?.code === 'PASSWORD_CHANGE_REQUIRED',
    JSON.stringify(r.body)
  );

  r = await owner.call('POST', '/api/auth/change-password', {
    currentPassword: boot.password,
    newPassword: 'OwnerPass1!',
  });
  check('password change succeeds', r.status === 200, JSON.stringify(r.body));
  check('state becomes AUTHENTICATED', r.body?.data?.state === 'AUTHENTICATED');
  owner.adopt(r.body.data);

  r = await owner.call('GET', '/api/platform/companies');
  check('platform endpoints now reachable', r.status === 200, JSON.stringify(r.body));

  section('Platform owner: companies and company administrators');

  r = await owner.call('POST', '/api/platform/companies', { name: 'No Admin Ltd' });
  check(
    'company without an administrator is refused',
    r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR',
    JSON.stringify(r.body)
  );

  r = await owner.call('POST', '/api/platform/companies', {
    name: 'Alpha Industries',
    admin: { username: 'alpha.admin', email: 'alpha.admin@example.com', displayName: 'Alpha Admin' },
  });
  check('creates company A', r.status === 201, JSON.stringify(r.body));
  const companyA = r.body?.data?.id;
  check(
    'creates company A administrator with it',
    r.body?.data?.admin?.username === 'alpha.admin',
    JSON.stringify(r.body?.data)
  );
  check('the administrator holds COMPANY_ADMIN', r.body?.data?.admin?.role === 'COMPANY_ADMIN');
  check('the administrator belongs to the new company', r.body?.data?.admin?.companyId === companyA);
  check('new account is pending', r.body?.data?.admin?.status === 'pending');
  check(
    'response contains no password field',
    !JSON.stringify(r.body).includes('password_hash') && !('password' in (r.body?.data?.admin || {}))
  );

  r = await owner.call('POST', '/api/platform/companies', {
    name: 'Beta Corp',
    admin: { username: 'beta.admin', email: 'beta.admin@example.com' },
  });
  check('creates company B', r.status === 201, JSON.stringify(r.body));
  const companyB = r.body?.data?.id;

  r = await owner.call('POST', '/api/platform/companies', {
    name: 'Rollback Test Ltd',
    admin: { username: 'alpha.admin', email: 'someone.else@example.com' },
  });
  check(
    'duplicate administrator is refused',
    r.status === 409 && r.body?.error?.code === 'CONFLICT',
    JSON.stringify(r.body)
  );

  r = await owner.call('GET', '/api/platform/companies');
  check(
    'the rejected company was not created',
    !(r.body?.data?.items || []).some((c: any) => c.name === 'Rollback Test Ltd'),
    JSON.stringify(r.body)
  );

  r = await owner.call('PUT', `/api/platform/companies/${companyA}/dashboards/default`);
  check('assigns the dashboard to company A', r.status === 200, JSON.stringify(r.body));

  section('Onboarding email and activation');

  const mail = latestEmail('alpha.admin@example.com');
  check('activation email was written', Boolean(mail));
  check('email contains the application URL', (mail || '').includes(APPLICATION_URL), APPLICATION_URL);
  check('email contains the username', (mail || '').includes('alpha.admin'));
  check('email contains a security notice', /Security notice/i.test(mail || ''));
  check('email contains first-login instructions', /First sign-in/i.test(mail || ''));
  check('email contains no password', !/password:\s*\S/i.test(mail || ''));

  const alphaToken = activationTokenFrom(mail);
  check('email contains an activation link', Boolean(alphaToken));

  const alphaAdmin = client('alphaAdmin');
  r = await alphaAdmin.call('GET', `/api/auth/activation?token=${encodeURIComponent(alphaToken!)}`);
  check(
    'activation link describes the account',
    r.status === 200 && r.body?.data?.username === 'alpha.admin',
    JSON.stringify(r.body)
  );

  r = await alphaAdmin.call('POST', '/api/auth/activation', { token: alphaToken, password: 'short' });
  check('weak password is rejected', r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR');

  r = await alphaAdmin.call('POST', '/api/auth/activation', { token: alphaToken, password: 'AlphaAdmin1!' });
  check(
    'activation sets the password and signs in',
    r.status === 200 && r.body?.data?.state === 'AUTHENTICATED',
    JSON.stringify(r.body)
  );
  alphaAdmin.adopt(r.body.data);

  const replay = client('replay');
  r = await replay.call('POST', '/api/auth/activation', { token: alphaToken, password: 'Another1!' });
  check(
    'activation link is single use',
    r.status === 400 && r.body?.error?.code === 'INVALID_ACTIVATION_TOKEN',
    JSON.stringify(r.body)
  );

  section('Company administrator: scoped to their own company');

  r = await alphaAdmin.call('GET', '/api/users?pageSize=100');
  const alphaDirectory = r.body?.data?.items || [];
  check(
    'sees only their company',
    r.status === 200 &&
      alphaDirectory.length > 0 &&
      !alphaDirectory.some((u: any) => u.username.startsWith('beta.')) &&
      !alphaDirectory.some((u: any) => 'companyName' in u),
    JSON.stringify(alphaDirectory.map((u: any) => u.username))
  );

  r = await alphaAdmin.call('GET', `/api/users?companyId=${companyB}&pageSize=100`);
  check(
    'companyId cannot widen a company caller',
    r.status === 200 && !(r.body?.data?.items || []).some((u: any) => u.username.startsWith('beta.')),
    JSON.stringify(r.body?.data)
  );

  r = await alphaAdmin.call('GET', '/api/users?search=beta');
  check('search stays inside the company', r.status === 200 && r.body?.data?.total === 0, JSON.stringify(r.body?.data));

  r = await alphaAdmin.call('GET', '/api/users?sort=password_hash');
  check(
    'an unknown sort key is refused',
    r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR',
    JSON.stringify(r.body)
  );

  r = await alphaAdmin.call('GET', '/api/users?pageSize=1');
  check(
    'a page holds pageSize rows and the total counts all',
    r.status === 200 && r.body?.data?.items?.length === 1 && r.body?.data?.total === alphaDirectory.length,
    JSON.stringify(r.body?.data)
  );

  r = await alphaAdmin.call('GET', '/api/workspace/company');
  check('reads their own company', r.status === 200 && r.body.data?.id === companyA, JSON.stringify(r.body));

  r = await alphaAdmin.call('GET', '/api/workspace/overview');
  check(
    'own-company counts are scoped to them',
    r.status === 200 && r.body.data?.users === alphaDirectory.length,
    JSON.stringify(r.body)
  );

  r = await alphaAdmin.call('GET', '/api/platform/companies');
  check(
    'cannot list every company',
    r.status === 403 && r.body?.error?.code === 'TENANT_ACCESS_DENIED',
    JSON.stringify(r.body)
  );

  r = await alphaAdmin.call('POST', '/api/platform/companies', { name: 'Sneaky Ltd' });
  check(
    'cannot create a company',
    r.status === 403 && r.body?.error?.code === 'TENANT_ACCESS_DENIED',
    JSON.stringify(r.body)
  );

  r = await alphaAdmin.call('GET', '/api/platform/users');
  check(
    'cannot read the cross-tenant directory',
    r.status === 403 && r.body?.error?.code === 'TENANT_ACCESS_DENIED',
    JSON.stringify(r.body)
  );

  r = await alphaAdmin.call('POST', '/api/users', {
    username: 'alpha.user',
    email: 'alpha.user@example.com',
    role: 'USER',
  });
  check('creates a user in their company', r.status === 201, JSON.stringify(r.body));
  const alphaUserId = r.body?.data?.id;
  check('created user is placed in the admin company', r.body?.data?.companyId === companyA);

  r = await alphaAdmin.call('POST', '/api/users', {
    companyId: companyB,
    username: 'cross.user',
    email: 'cross@example.com',
    role: 'USER',
  });
  check(
    'companyId in the body is ignored, not honoured',
    r.status === 201 && r.body?.data?.companyId === companyA,
    JSON.stringify(r.body?.data)
  );
  const ignoredId = r.body?.data?.id;
  if (ignoredId) await alphaAdmin.call('DELETE', `/api/users/${ignoredId}`);

  r = await alphaAdmin.call('POST', '/api/users', {
    username: 'wannabe',
    email: 'wannabe@example.com',
    role: 'SUPER_ADMIN',
  });
  check(
    'cannot create a SUPER_ADMIN',
    r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR',
    JSON.stringify(r.body)
  );

  r = await owner.call('GET', `/api/platform/users?companyId=${companyB}&search=beta.admin`);
  const betaAdminId = r.body.data.items.find((u: any) => u.username === 'beta.admin').id;

  r = await alphaAdmin.call('GET', `/api/users/${betaAdminId}`);
  check(
    'another company\u2019s user is a 404, not a 403',
    r.status === 404 && r.body?.error?.code === 'RESOURCE_NOT_FOUND',
    JSON.stringify(r.body)
  );

  r = await alphaAdmin.call('PATCH', `/api/users/${betaAdminId}`, { role: 'USER' });
  check('cannot modify another company\u2019s user', r.status === 404, JSON.stringify(r.body));

  r = await alphaAdmin.call('DELETE', `/api/users/${betaAdminId}`);
  check('cannot delete another company\u2019s user', r.status === 404);

  r = await owner.call('GET', '/api/platform/users?role=SUPER_ADMIN');
  const ownerId = r.body.data.items.find((u: any) => u.role === 'SUPER_ADMIN').id;
  r = await alphaAdmin.call('PATCH', `/api/users/${ownerId}`, { role: 'USER' });
  check(
    'cannot manage the platform owner',
    r.status === 404 || r.status === 403,
    `${r.status} ${JSON.stringify(r.body)}`
  );

  section('Dashboard access and tenant isolation of data');

  r = await alphaAdmin.call('GET', '/api/access/dashboards');
  check(
    'admin sees the assigned dashboard',
    r.status === 200 && r.body.data.some((d: any) => d.id === 'default'),
    JSON.stringify(r.body?.data)
  );

  r = await alphaAdmin.call('PUT', `/api/access/dashboards/default/users/${alphaUserId}`, {
    levelId: accessLevelId('dashboard', 'view'),
  });
  check('grants the dashboard to their user', r.status === 200, JSON.stringify(r.body));

  const betaAdmin = client('betaAdmin');
  const betaToken = activationTokenFrom(latestEmail('beta.admin@example.com'));
  r = await betaAdmin.call('POST', '/api/auth/activation', { token: betaToken, password: 'BetaAdmin1!' });
  check('company B administrator activates', r.status === 200, JSON.stringify(r.body));
  betaAdmin.adopt(r.body.data);

  r = await betaAdmin.call('GET', '/api/dashboard/default');
  check(
    'company B cannot read the unassigned dashboard',
    r.status === 404 && r.body?.error?.code === 'DASHBOARD_NOT_FOUND',
    `${r.status} ${JSON.stringify(r.body)}`
  );

  r = await betaAdmin.call('GET', '/api/access/dashboards');
  check('company B has no dashboards listed', r.status === 200 && r.body.data.length === 0);

  r = await betaAdmin.call('PUT', `/api/access/dashboards/default/users/${alphaUserId}`, {
    levelId: accessLevelId('dashboard', 'admin'),
  });
  check('company B cannot grant company A\u2019s user', r.status === 404, `${r.status} ${JSON.stringify(r.body)}`);

  section('Plain user: least privilege');

  const alphaUser = client('alphaUser');
  const userToken = activationTokenFrom(latestEmail('alpha.user@example.com'));
  r = await alphaUser.call('POST', '/api/auth/activation', { token: userToken, password: 'AlphaUser1!' });
  check('user activates and is signed in', r.status === 200, JSON.stringify(r.body));
  alphaUser.adopt(r.body.data);

  r = await alphaUser.call('GET', '/api/dashboard/default');
  check(
    'user reads the granted dashboard',
    r.status === 200 && Array.isArray(r.body?.data?.cards),
    `${r.status} ${JSON.stringify(r.body?.error)}`
  );
  check(
    'dashboard view still has cards and slicers',
    (r.body?.data?.cards || []).length > 0 && Array.isArray(r.body?.data?.slicers)
  );

  r = await alphaUser.call('GET', '/api/users');
  check('user cannot list users', r.status === 403 && r.body?.error?.code === 'INSUFFICIENT_PERMISSION');

  r = await alphaUser.call('POST', '/api/users', { username: 'x.y', email: 'x@y.com', role: 'USER' });
  check('user cannot create users', r.status === 403);

  r = await alphaUser.call('GET', '/api/workspace/company');
  check(
    'user cannot read their own company either',
    r.status === 403 && r.body?.error?.code === 'INSUFFICIENT_PERMISSION',
    JSON.stringify(r.body)
  );

  r = await alphaUser.call('GET', '/api/platform/companies');
  check(
    'user cannot reach the platform namespace',
    r.status === 403 && r.body?.error?.code === 'TENANT_ACCESS_DENIED',
    JSON.stringify(r.body)
  );

  r = await alphaUser.call('PUT', `/api/platform/roles/${systemRoleId('USER')}/permissions`, { permissionIds: [] });
  check('user cannot edit role permissions', r.status === 403);

  r = await alphaUser.call('PATCH', '/api/dashboard/default/config', { index: 0, card: {} });
  check('user cannot edit the dashboard', r.status === 403, `${r.status} ${JSON.stringify(r.body?.error)}`);

  r = await alphaUser.call('POST', '/api/dashboard/preview', { dashboardId: 'default', card: {} });
  check('user cannot run an arbitrary preview query', r.status === 403);

  section('Groups: company-scoped membership and inherited access');

  r = await alphaAdmin.call('POST', '/api/groups', { name: 'Finance' });
  check('an admin creates a group in their company', r.status === 201, JSON.stringify(r.body));
  const groupId = r.body?.data?.id;
  check('the group belongs to the admin’s company', r.body?.data?.companyId === companyA);

  r = await betaAdmin.call('POST', '/api/groups', { name: 'Finance' });
  check('another company may use the same group name', r.status === 201, JSON.stringify(r.body));
  const betaGroupId = r.body?.data?.id;

  r = await alphaAdmin.call('POST', '/api/groups', { name: 'Finance' });
  check('the same name twice in one company is refused', r.status === 409, JSON.stringify(r.body));

  r = await alphaAdmin.call('PUT', `/api/groups/${groupId}`, { userIds: [alphaUserId] });
  check('their own user can be added as a member', r.status === 200, JSON.stringify(r.body));

  r = await owner.call('GET', `/api/platform/users?companyId=${companyB}&search=beta.admin`);
  const betaUserId = r.body.data.items.find((u: any) => u.username === 'beta.admin').id;
  r = await alphaAdmin.call('PUT', `/api/groups/${groupId}`, { userIds: [betaUserId] });
  check(
    'a member from another company is refused',
    r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR',
    JSON.stringify(r.body)
  );

  r = await alphaAdmin.call('GET', `/api/groups/${betaGroupId}`);
  check('another company’s group is a 404', r.status === 404, JSON.stringify(r.body));

  r = await alphaAdmin.call('PUT', `/api/access/dashboards/default/groups/${betaGroupId}`, {
    levelId: accessLevelId('dashboard', 'admin'),
  });
  check('another company’s group cannot be granted', r.status === 404, JSON.stringify(r.body));

  await alphaAdmin.call('DELETE', `/api/access/dashboards/default/users/${alphaUserId}`);
  r = await alphaUser.call('GET', '/api/access/dashboards');
  check('the direct grant is gone', r.status === 200 && r.body.data.length === 0, JSON.stringify(r.body?.data));

  r = await alphaAdmin.call('PUT', `/api/access/dashboards/default/groups/${groupId}`, {
    levelId: accessLevelId('dashboard', 'view'),
  });
  check('the dashboard is granted to the group', r.status === 200, JSON.stringify(r.body));

  r = await alphaUser.call('GET', '/api/access/dashboards');
  check(
    'the member inherits access through the group',
    r.status === 200 && r.body.data.some((d: any) => d.id === 'default'),
    JSON.stringify(r.body?.data)
  );

  r = await alphaUser.call('GET', '/api/dashboard/default');
  check('and can read the dashboard', r.status === 200, `${r.status} ${JSON.stringify(r.body?.error)}`);

  r = await alphaAdmin.call('PUT', `/api/groups/${groupId}`, { active: false });
  check('the group can be deactivated', r.status === 200, JSON.stringify(r.body));
  r = await alphaUser.call('GET', '/api/dashboard/default');
  check(
    'a deactivated group stops passing access on',
    r.status === 404,
    `${r.status} ${JSON.stringify(r.body?.error)}`
  );

  await alphaAdmin.call('PUT', `/api/groups/${groupId}`, { active: true });
  r = await alphaUser.call('GET', '/api/dashboard/default');
  check('reactivating the group restores it', r.status === 200, `${r.status}`);

  r = await alphaAdmin.call('DELETE', `/api/groups/${groupId}`);
  check('the group can be deleted', r.status === 200, JSON.stringify(r.body));
  r = await alphaUser.call('GET', '/api/dashboard/default');
  check('deleting the group takes the inherited access with it', r.status === 404, `${r.status}`);

  await alphaAdmin.call('PUT', `/api/access/dashboards/default/users/${alphaUserId}`, {
    levelId: accessLevelId('dashboard', 'view'),
  });

  section('Role permissions and the platform boundary');

  r = await owner.call('PUT', `/api/platform/roles/${systemRoleId('COMPANY_ADMIN')}/permissions`, {
    permissionIds: pids('user.read', 'company.create'),
  });
  check(
    'a company role cannot be given a platform permission',
    r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR',
    JSON.stringify(r.body)
  );

  r = await owner.call('PUT', `/api/platform/roles/${systemRoleId('SUPER_ADMIN')}/permissions`, { permissionIds: [] });
  check('SUPER_ADMIN permissions cannot be edited', r.status === 400, JSON.stringify(r.body));

  r = await owner.call('GET', `/api/platform/roles/${systemRoleId('USER')}/permissions`);
  check(
    'the Member role that reads contexts can also edit and delete them, as before',
    ['context.read', 'context.update', 'context.delete'].every((p) => keysIn(r.body?.data?.permissionIds).includes(p)),
    JSON.stringify(keysIn(r.body?.data?.permissionIds))
  );

  r = await owner.call('PUT', `/api/platform/roles/${systemRoleId('USER')}/permissions`, {
    permissionIds: pids('dashboard.read', 'data.read'),
  });
  check('USER permissions can be edited', r.status === 200, JSON.stringify(r.body));

  section('Company features: set by the platform owner, a ceiling on every role');

  r = await owner.call('GET', '/api/platform/features');
  check(
    'the platform lists the features',
    r.status === 200 && (r.body?.data || []).some((f: any) => f.key === 'metadata_lakehouse' && f.locked),
    JSON.stringify(r.body)
  );

  r = await owner.call('GET', `/api/platform/companies/${companyA}/features`);
  check(
    'a company created without a list has every feature',
    r.status === 200 && (r.body?.data?.features || []).every((f: any) => f.enabled),
    JSON.stringify(r.body)
  );

  r = await owner.call('POST', '/api/platform/companies', {
    name: 'Gamma Labs',
    featureIds: featureIdsOf(['data_analyst', 'agents']),
    admin: { username: 'gamma.admin', email: 'gamma.admin@example.com' },
  });
  const companyC = r.body?.data?.id;
  check(
    'a company can be created with chosen features, hidden ones left out',
    r.status === 201 &&
      JSON.stringify(r.body?.data?.features) === JSON.stringify(['metadata_lakehouse', 'data_analyst']),
    JSON.stringify(r.body?.data)
  );

  r = await owner.call('POST', '/api/platform/companies', {
    name: 'Bad Feature Co',
    featureIds: ['00000000-0000-4000-8000-000000000000'],
    admin: { username: 'bad.feature', email: 'bad.feature@example.com' },
  });
  check(
    'an unknown feature is refused',
    r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR',
    JSON.stringify(r.body)
  );

  r = await alphaAdmin.call('PUT', `/api/platform/companies/${companyA}/features`, { featureIds: [] });
  check('a company admin cannot change features', r.status === 403, JSON.stringify(r.body));

  r = await owner.call('GET', '/api/platform/features');
  check(
    'the feature list leaves out hidden features',
    r.status === 200 &&
      JSON.stringify((r.body?.data || []).map((f: any) => f.key)) ===
        JSON.stringify(['metadata_lakehouse', 'data_analyst']),
    JSON.stringify(r.body?.data)
  );

  r = await owner.call('PUT', `/api/platform/companies/${companyA}/features`, { featureIds: [] });
  check(
    'the platform owner switches the data analyst off',
    r.status === 200 &&
      !(r.body?.data?.features || []).find((f: any) => f.key === 'data_analyst')?.enabled &&
      !(r.body?.data?.features || []).some((f: any) => f.key === 'dashboards' || f.key === 'agents'),
    JSON.stringify(r.body)
  );

  r = await alphaAdmin.call('GET', '/api/auth/me');
  check(
    'a disabled feature is masked on the next request',
    r.status === 200 && !(r.body?.data?.user?.permissions || []).includes('analyst.use'),
    JSON.stringify(r.body?.data?.user)
  );
  r = await alphaUser.call('GET', '/api/dashboard/default');
  check(
    'saving the visible features keeps the hidden ones as they were',
    r.status === 200,
    `${r.status} ${JSON.stringify(r.body?.error)}`
  );

  r = await alphaAdmin.call('GET', '/api/auth/me');
  check(
    'the session reports the features and masks the permissions',
    r.status === 200 &&
      !(r.body?.data?.user?.features || []).includes('data_analyst') &&
      (r.body?.data?.user?.features || []).includes('metadata_lakehouse') &&
      !(r.body?.data?.user?.permissions || []).includes('analyst.use') &&
      (r.body?.data?.user?.permissions || []).includes('user.read'),
    JSON.stringify(r.body?.data?.user)
  );
  check(
    'and never mentions dashboards or agents',
    r.body?.data?.dashboards === undefined &&
      !/"(dashboard|data|access|scope|agent)\.|"dashboards"|"agents"/.test(JSON.stringify(r.body?.data?.user || {})),
    JSON.stringify(r.body?.data)
  );

  r = await owner.call('PUT', `/api/platform/companies/${companyA}/features`, {
    featureIds: featureIdsOf(['data_analyst']),
  });
  check('switching it back on is accepted', r.status === 200, JSON.stringify(r.body));
  r = await alphaAdmin.call('GET', '/api/auth/me');
  check(
    'switching it back on restores access exactly',
    r.status === 200 && (r.body?.data?.user?.permissions || []).includes('analyst.use'),
    JSON.stringify(r.body?.data?.user?.permissions)
  );

  section('Company roles: created by the company admin');

  r = await alphaAdmin.call('POST', '/api/roles', {
    name: 'Analyst',
    permissionIds: pids('playbook.create', 'context.update'),
  });
  const analystRoleId = r.body?.data?.id;
  check('a company admin creates a role', r.status === 201, JSON.stringify(r.body));
  check(
    'Create/Edit imply View',
    ['playbook.read', 'playbook.create', 'context.read', 'context.update'].every((p) =>
      keysIn(r.body?.data?.permissionIds).includes(p)
    ),
    JSON.stringify(r.body?.data)
  );
  r = await alphaAdmin.call('POST', '/api/roles', { name: 'Hidden', permissionIds: pids('agent.read') });
  check(
    'a hidden feature cannot be given to a role',
    r.status === 403 && r.body?.error?.code === 'FEATURE_NOT_ENABLED',
    JSON.stringify(r.body)
  );

  r = await alphaAdmin.call('POST', '/api/roles', { name: 'Analyst', permissionIds: [] });
  check('a duplicate role name is refused', r.status === 409, JSON.stringify(r.body));
  r = await alphaAdmin.call('POST', '/api/roles', { name: 'Company Admin', permissionIds: [] });
  check('a built-in role name is refused', r.status === 400, JSON.stringify(r.body));
  r = await alphaAdmin.call('POST', '/api/roles', { name: 'People', permissionIds: pids('user.create') });
  check(
    'a custom role cannot manage people',
    r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR',
    JSON.stringify(r.body)
  );
  r = await alphaAdmin.call('POST', '/api/roles', { name: 'Owner', permissionIds: pids('company.features') });
  check('a custom role cannot hold a platform permission', r.status === 400, JSON.stringify(r.body));

  r = await owner.call('POST', '/api/roles', {
    companyId: companyC,
    name: 'Dash',
    permissionIds: pids('dashboard.read'),
  });
  check(
    'a role cannot hold a feature its company lacks',
    r.status === 403 && r.body?.error?.code === 'FEATURE_NOT_ENABLED',
    JSON.stringify(r.body)
  );
  check(
    'the refusal does not name the feature',
    !r.body?.error?.details && !/dashboard/i.test(r.body?.error?.message || ''),
    JSON.stringify(r.body)
  );

  r = await owner.call('GET', `/api/roles/permissions?companyId=${companyC}`);
  check(
    'the role grid leaves out features the company lacks',
    r.status === 200 &&
      !(r.body?.data?.permissions || []).some((p: any) => /^(dashboard|data|access|scope|agent)\./.test(p.key)) &&
      (r.body?.data?.permissions || []).some((p: any) => p.key === 'analyst.use'),
    JSON.stringify((r.body?.data?.permissions || []).map((p: any) => p.key))
  );

  r = await owner.call('GET', `/api/roles?companyId=${companyC}`);
  check(
    'a new company has its own Member role, following the defaults',
    r.status === 200 && r.body?.data?.builtIn?.find((b: any) => b.name === 'USER')?.customized === false,
    JSON.stringify(r.body?.data?.builtIn)
  );

  r = await alphaUser.call('GET', '/api/auth/me');
  check(
    'a member is only told about features it can use',
    r.status === 200 && !(r.body?.data?.user?.features || []).some((f: string) => f === 'dashboards' || f === 'agents'),
    JSON.stringify(r.body?.data?.user?.features)
  );

  r = await betaAdmin.call('GET', `/api/roles/${analystRoleId}`);
  check("another company's role is not found", r.status === 404, JSON.stringify(r.body));
  r = await betaAdmin.call('GET', `/api/roles?companyId=${companyA}`);
  check(
    'companyId cannot widen a company caller',
    r.status === 200 && !(r.body?.data?.custom || []).some((x: any) => x.id === analystRoleId),
    JSON.stringify(r.body?.data)
  );

  const gate = (uri: string, method: string) => ({ headers: { 'X-Original-URI': uri, 'X-Original-Method': method } });

  const analystChat = '/svc/adk/contexts/no-such-connection/data-analyst/sessions';
  r = await alphaUser.call('GET', '/api/gate/agents', undefined, gate(analystChat, 'POST'));
  check('the agent gate refuses a role without an agent permission', r.status === 403, String(r.status));
  r = await alphaUser.call('GET', '/api/gate/agents', undefined, gate('/svc/adk/health', 'GET'));
  check('the agent gate lets a signed-in account read ADK health', r.status === 204, String(r.status));
  r = await alphaUser.call('GET', '/api/gate/agents', undefined, gate('/svc/mojo/sessions', 'GET'));
  check('the retired Mojo service is refused outright', r.status === 403, String(r.status));

  r = await alphaAdmin.call('PATCH', `/api/users/${alphaUserId}`, {
    customRoleId: '00000000-0000-4000-8000-000000000001',
  });
  check('an unknown role cannot be assigned', r.status === 404, JSON.stringify(r.body));
  r = await alphaAdmin.call('PATCH', `/api/users/${alphaUserId}`, { customRoleId: analystRoleId });
  check(
    'a company admin gives a member the role',
    r.status === 200 && r.body?.data?.customRoleId === analystRoleId,
    JSON.stringify(r.body)
  );

  r = await alphaUser.call('GET', '/api/auth/me');
  check(
    "the member now holds exactly the role's permissions",
    r.status === 200 &&
      (r.body?.data?.user?.permissions || []).includes('playbook.create') &&
      !(r.body?.data?.user?.permissions || []).includes('analyst.use'),
    JSON.stringify(r.body?.data?.user?.permissions)
  );

  r = await alphaUser.call('GET', '/api/gate/agents', undefined, gate(analystChat, 'POST'));
  check('the agent gate refuses an action the role lacks', r.status === 403, String(r.status));
  r = await alphaUser.call('GET', '/api/gate/agents', undefined, { noAuth: true, ...gate(analystChat, 'GET') });
  check('the agent gate refuses an anonymous call with 401', r.status === 401, String(r.status));

  r = await alphaAdmin.call('DELETE', `/api/roles/${analystRoleId}`);
  check('a role still held cannot be deleted', r.status === 409, JSON.stringify(r.body));
  r = await alphaAdmin.call('PATCH', `/api/users/${alphaUserId}`, { customRoleId: null });
  check(
    'the member goes back to the built-in role',
    r.status === 200 && r.body?.data?.customRoleId === null,
    JSON.stringify(r.body)
  );
  r = await alphaAdmin.call('DELETE', `/api/roles/${analystRoleId}`);
  check('an unused role is deleted', r.status === 200, JSON.stringify(r.body));

  r = await alphaAdmin.call('POST', '/api/roles', { name: 'Context reader', permissionIds: pids('context.read') });
  const readerRoleId = r.body?.data?.id;
  check('a role can hold context.read alone', r.status === 201, JSON.stringify(r.body));
  r = await alphaAdmin.call('PATCH', `/api/users/${alphaUserId}`, { customRoleId: readerRoleId });
  const noSuchConnection = '00000000-0000-4000-8000-000000000404';
  r = await alphaUser.call('PUT', `/api/context/connections/${noSuchConnection}/datasets`, { datasets: [] });
  check(
    'reading contexts does not let a role change them',
    r.status === 403 && r.body?.error?.code === 'INSUFFICIENT_PERMISSION',
    `${r.status} ${JSON.stringify(r.body?.error)}`
  );
  r = await alphaUser.call('DELETE', `/api/context/connections/${noSuchConnection}`);
  check('or delete them', r.status === 403, `${r.status} ${JSON.stringify(r.body?.error)}`);
  r = await alphaUser.call('GET', `/api/context/connections/${noSuchConnection}`);
  check(
    'while reading still passes the permission check',
    r.status === 404,
    `${r.status} ${JSON.stringify(r.body?.error)}`
  );
  await alphaAdmin.call('PATCH', `/api/users/${alphaUserId}`, { customRoleId: null });
  r = await alphaAdmin.call('DELETE', `/api/roles/${readerRoleId}`);
  check('the reader role is removed again', r.status === 200, JSON.stringify(r.body));

  r = await alphaAdmin.call('GET', '/api/roles');
  const alphaMemberRoleId = r.body?.data?.builtIn?.find((b: any) => b.name === 'USER')?.id;
  check(
    'the company Member role has its own UUID',
    typeof alphaMemberRoleId === 'string' && alphaMemberRoleId !== systemRoleId('USER'),
    String(alphaMemberRoleId)
  );
  r = await alphaAdmin.call('PUT', `/api/roles/built-in/${systemRoleId('COMPANY_ADMIN')}`, { permissionIds: [] });
  check('the company admin role cannot be changed by a company', r.status === 400, JSON.stringify(r.body));
  r = await alphaAdmin.call('PUT', `/api/roles/built-in/${alphaMemberRoleId}`, {
    permissionIds: pids('playbook.read'),
  });
  check(
    'a company admin tailors the Member role',
    r.status === 200 && r.body?.data?.builtIn?.find((b: any) => b.name === 'USER')?.customized === true,
    JSON.stringify(r.body?.data?.builtIn)
  );
  r = await alphaUser.call('GET', '/api/auth/me');
  check(
    "members follow their company's Member role",
    r.status === 200 && JSON.stringify(r.body?.data?.user?.permissions) === JSON.stringify(['playbook.read']),
    JSON.stringify(r.body?.data?.user?.permissions)
  );
  r = await betaAdmin.call('GET', '/api/roles');
  check(
    '...and only that company',
    r.status === 200 && r.body?.data?.builtIn?.find((b: any) => b.name === 'USER')?.customized === false,
    JSON.stringify(r.body?.data?.builtIn)
  );
  r = await alphaAdmin.call('DELETE', `/api/roles/built-in/${alphaMemberRoleId}`);
  check(
    'Member resets to the platform defaults',
    r.status === 200 && r.body?.data?.builtIn?.find((b: any) => b.name === 'USER')?.customized === false,
    JSON.stringify(r.body)
  );
  r = await alphaUser.call('GET', '/api/dashboard/default');
  check('the reset restores the defaults', r.status === 200, `${r.status} ${JSON.stringify(r.body?.error)}`);

  section('Extra permissions for one member');

  r = await alphaAdmin.call('PUT', `/api/users/${alphaUserId}/permissions`, { permissionIds: pids('playbook.delete') });
  check(
    'a company admin gives one member an extra permission',
    r.status === 200 && keysIn(r.body?.data?.extraPermissionIds).includes('playbook.delete'),
    JSON.stringify(r.body)
  );
  r = await alphaUser.call('GET', '/api/auth/me');
  check(
    'the extra permission reaches that member',
    r.status === 200 && (r.body?.data?.user?.permissions || []).includes('playbook.delete'),
    JSON.stringify(r.body?.data?.user?.permissions)
  );
  r = await alphaAdmin.call('PUT', `/api/users/${alphaUserId}/permissions`, { permissionIds: pids('user.create') });
  check('an admin-only permission cannot be given to one member', r.status === 400, JSON.stringify(r.body));
  r = await alphaAdmin.call('PUT', `/api/users/${alphaUserId}/permissions`, { permissionIds: [] });
  r = await alphaUser.call('GET', '/api/auth/me');
  check(
    'removing it takes it away again',
    r.status === 200 && !(r.body?.data?.user?.permissions || []).includes('playbook.delete'),
    JSON.stringify(r.body?.data?.user?.permissions)
  );

  section('Audit trail: stored in the database, scoped by role');

  await new Promise((done) => setTimeout(done, 500));

  const inCompany = (item: any, id: string) => item.companyId === id || item.actorCompanyId === id;

  r = await owner.call('GET', '/api/audit?pageSize=100');
  const ownerItems: any[] = r.body?.data?.items || [];
  check(
    'the platform owner reads the whole trail',
    r.status === 200 && r.body?.data?.scope === 'all',
    `${r.status} ${r.body?.data?.scope}`
  );
  check(
    'which spans both companies',
    ownerItems.some((i) => inCompany(i, companyA)) && ownerItems.some((i) => inCompany(i, companyB))
  );
  check(
    'entries name the company they belong to',
    ownerItems.some((i) => i.companyName === 'Alpha Industries')
  );
  check('newest first by default', ownerItems.length < 2 || String(ownerItems[0].ts) >= String(ownerItems[1].ts));

  r = await owner.call('GET', '/api/audit?event=company_created');
  const createdCompanyIds = (r.body?.data?.items || []).map((i: any) => i.companyId).sort();
  check(
    'the event filter narrows the trail',
    r.status === 200 &&
      r.body.data.items.every((i: any) => i.event === 'company_created') &&
      JSON.stringify(createdCompanyIds) === JSON.stringify([companyA, companyB, companyC].sort()),
    JSON.stringify(createdCompanyIds)
  );

  r = await owner.call('GET', '/api/audit?category=company&pageSize=8');
  const companyEvents: any[] = r.body?.data?.items || [];
  check(
    'the company category leaves out sign-ins',
    r.status === 200 &&
      companyEvents.length > 0 &&
      companyEvents.every((i) => /^(company_|dashboard_|context_|access_granted|access_revoked)/.test(i.event)),
    JSON.stringify(companyEvents.map((i) => i.event))
  );
  check(
    'and is filtered by the server, so a page is full even after many sign-ins',
    r.body?.data?.total >= companyEvents.length && companyEvents.length === Math.min(8, r.body?.data?.total)
  );

  r = await owner.call('GET', '/api/audit?category=nonsense');
  check('an unknown category is a validation error', r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR');

  r = await owner.call('GET', '/api/audit?category=lakehouse&pageSize=100');
  check(
    'the lakehouse category holds only Metadata Lakehouse events, never a sign-in',
    r.status === 200 && (r.body?.data?.items || []).every((i: any) => i.event.startsWith('context_')),
    JSON.stringify((r.body?.data?.items || []).map((i: any) => i.event))
  );

  r = await owner.call('GET', '/api/audit?category=auth&pageSize=100');
  check(
    'the auth category holds the sign-ins',
    r.status === 200 &&
      r.body?.data?.total > 0 &&
      r.body.data.items.every((i: any) => /^(login_|logout|session_|refresh_|password_|account_)/.test(i.event))
  );

  r = await owner.call('GET', '/api/audit?action=create&pageSize=100');
  check(
    'the create action matches created/published/granted events only',
    r.status === 200 &&
      r.body?.data?.total > 0 &&
      r.body.data.items.every((i: any) => /_(created|published|granted|assigned|activated)$/.test(i.event)),
    JSON.stringify((r.body?.data?.items || []).map((i: any) => i.event))
  );

  r = await owner.call('GET', '/api/audit?action=nonsense');
  check('an unknown action is a validation error', r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR');

  const today = new Date().toISOString().slice(0, 10);
  r = await owner.call('GET', `/api/audit?from=${today}&to=${today}&pageSize=1`);
  check("a date range including today finds today's entries", r.status === 200 && r.body?.data?.total > 0);
  r = await owner.call('GET', '/api/audit?from=2000-01-01&to=2000-01-02');
  check('a date range in the past finds nothing', r.status === 200 && r.body?.data?.total === 0);
  r = await owner.call('GET', '/api/audit?from=yesterday');
  check('a malformed date is a validation error', r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR');

  r = await owner.call('GET', '/api/audit?search=Beta%20Corp');
  check(
    'search reaches the company name and the detail',
    r.status === 200 &&
      r.body?.data?.total > 0 &&
      r.body.data.items.every((i: any) => JSON.stringify(i).includes('Beta')),
    JSON.stringify(r.body?.data?.total)
  );

  r = await alphaAdmin.call('GET', '/api/audit?pageSize=100');
  const alphaItems: any[] = r.body?.data?.items || [];
  check(
    'a company administrator reads their company trail',
    r.status === 200 && r.body?.data?.scope === 'company',
    `${r.status} ${r.body?.data?.scope}`
  );
  check(
    'and only their company',
    alphaItems.length > 0 && alphaItems.every((i) => inCompany(i, companyA)),
    JSON.stringify(alphaItems.find((i) => !inCompany(i, companyA)))
  );

  r = await betaAdmin.call('GET', '/api/audit?pageSize=100');
  check(
    'another company sees none of it',
    r.status === 200 && (r.body?.data?.items || []).every((i: any) => !inCompany(i, companyA))
  );

  r = await alphaUser.call('GET', '/api/audit?pageSize=100');
  const selfItems: any[] = r.body?.data?.items || [];
  check(
    'a user reads their own trail',
    r.status === 200 && r.body?.data?.scope === 'self',
    `${r.status} ${r.body?.data?.scope}`
  );
  check(
    'what they did and what was done to their account',
    selfItems.length > 0 && selfItems.every((i) => i.actorId === alphaUserId || i.detail?.userId === alphaUserId),
    JSON.stringify(selfItems.find((i) => i.actorId !== alphaUserId && i.detail?.userId !== alphaUserId))
  );
  check(
    'including a change made to their account by their administrator',
    selfItems.some((i) => i.actor === 'alpha.admin' && i.detail?.userId === alphaUserId)
  );
  check(
    'but no dashboard events, which are hidden',
    !selfItems.some((i) => /^(dashboard_|access_granted|access_revoked)/.test(i.event)),
    JSON.stringify(selfItems.map((i) => i.event))
  );

  section('Token lifecycle');

  const before = alphaUser.cookies.get('da_access');
  const beforeCookie = alphaUser.cookies.get('da_refresh');
  r = await alphaUser.call('POST', '/api/auth/refresh');
  check(
    'refresh sets a new access cookie',
    r.status === 200 && alphaUser.cookies.get('da_access') !== before,
    JSON.stringify(r.body?.error)
  );
  check('refresh response carries no token', !/token/i.test(Object.keys(r.body?.data || {}).join(',')));
  check('refresh rotates the refresh cookie', alphaUser.cookies.get('da_refresh') !== beforeCookie);
  alphaUser.adopt(r.body.data);

  const thief = client('thief');
  thief.cookies.set('da_refresh', beforeCookie!);
  thief.csrfToken = alphaUser.csrfToken;
  thief.cookies.set('da_csrf', alphaUser.csrfToken!);
  r = await thief.call('POST', '/api/auth/refresh');
  check(
    'a replayed refresh token is rejected',
    r.status === 401 && r.body?.error?.code === 'INVALID_REFRESH_TOKEN',
    JSON.stringify(r.body)
  );

  r = await alphaUser.call('POST', '/api/auth/refresh');
  check('reuse detection revokes the whole family', r.status === 401, `${r.status} ${JSON.stringify(r.body)}`);

  r = await alphaUser.call('POST', '/api/auth/login', { identifier: 'alpha.user', password: 'AlphaUser1!' });
  check('user can sign in again after the family was revoked', r.status === 200, JSON.stringify(r.body));
  alphaUser.adopt(r.body.data);

  r = await alphaUser.call('POST', '/api/auth/refresh', undefined, { noCsrf: true, csrf: undefined });
  const noCsrf = await (async () => {
    const headers = { Cookie: alphaUser.cookieHeader() };
    const res = await fetch(`${BASE}/api/auth/refresh`, { method: 'POST', headers });
    return { status: res.status, body: await res.json().catch(() => null) };
  })();
  check(
    'refresh without the CSRF header is refused',
    noCsrf.status === 403 && noCsrf.body?.error?.code === 'CSRF_TOKEN_INVALID',
    JSON.stringify(noCsrf.body)
  );

  const forged = await (async () => {
    const headers = { Cookie: alphaUser.cookieHeader(), 'Content-Type': 'application/json' };
    const res = await fetch(`${BASE}/api/auth/change-password`, { method: 'POST', headers, body: '{}' });
    return { status: res.status, body: await res.json().catch(() => null) };
  })();
  check(
    'a state-changing call without the CSRF header is refused',
    forged.status === 403 && forged.body?.error?.code === 'CSRF_TOKEN_INVALID',
    JSON.stringify(forged.body)
  );

  r = await alphaUser.call('POST', '/api/auth/logout');
  check('logout succeeds', r.status === 200);
  check('logout clears the refresh cookie', !alphaUser.cookies.has('da_refresh'));
  check('logout clears the access cookie', !alphaUser.cookies.has('da_access'));

  const stale = client('stale');
  stale.cookies.set('da_refresh', beforeCookie!);
  stale.cookies.set('da_csrf', 'x');
  stale.csrfToken = 'x';
  r = await stale.call('POST', '/api/auth/refresh');
  check('a revoked refresh token stays rejected', r.status === 401);

  section('Deactivation ends access');

  r = await alphaAdmin.call('POST', `/api/users/${alphaUserId}/deactivate`);
  check(
    'admin deactivates their user',
    r.status === 200 && r.body?.data?.status === 'disabled',
    JSON.stringify(r.body)
  );

  const disabled = client('disabled');
  r = await disabled.call('POST', '/api/auth/login', { identifier: 'alpha.user', password: 'AlphaUser1!' });
  check(
    'deactivated account cannot sign in',
    r.status === 403 && r.body?.error?.code === 'ACCOUNT_DISABLED',
    JSON.stringify(r.body)
  );

  r = await owner.call('PATCH', `/api/platform/companies/${companyA}`, { active: false });
  check('owner deactivates company A', r.status === 200);

  const blocked = client('blocked');
  r = await blocked.call('POST', '/api/auth/login', { identifier: 'alpha.admin', password: 'AlphaAdmin1!' });
  check(
    'a disabled company blocks its administrator',
    r.status === 403 && r.body?.error?.code === 'COMPANY_DISABLED',
    JSON.stringify(r.body)
  );

  r = await alphaAdmin.call('GET', '/api/users');
  check(
    'live session in a disabled company is dropped',
    r.status === 403 && r.body?.error?.code === 'COMPANY_DISABLED',
    `${r.status} ${JSON.stringify(r.body)}`
  );

  await owner.call('PATCH', `/api/platform/companies/${companyA}`, { active: true });

  section('Soft delete');

  const alphaBack = client('alphaBack');
  r = await alphaBack.call('POST', '/api/auth/login', { identifier: 'alpha.admin', password: 'AlphaAdmin1!' });
  check('company A admin signs back in', r.status === 200, JSON.stringify(r.body));
  const alphaAdminId = r.body?.data?.user?.id;

  r = await alphaBack.call('POST', '/api/users', {
    username: 'alpha.gone',
    email: 'alpha.gone@example.com',
    role: 'USER',
  });
  check('an admin creates an account to delete', r.status === 201, JSON.stringify(r.body));
  const goneId = r.body?.data?.id;
  const gone = client('gone');
  r = await gone.call('POST', '/api/auth/activation', {
    token: activationTokenFrom(latestEmail('alpha.gone@example.com')),
    password: 'GoneUser1!',
  });
  check('the account to delete activates', r.status === 200, JSON.stringify(r.body));

  r = await alphaBack.call('DELETE', `/api/users/${goneId}`);
  check('the admin deletes the account', r.status === 200, JSON.stringify(r.body));
  r = await alphaBack.call('GET', `/api/users/${goneId}`);
  check('a deleted account is a 404', r.status === 404, `${r.status} ${JSON.stringify(r.body)}`);
  r = await alphaBack.call('GET', '/api/users?search=alpha.gone');
  check(
    'a deleted account is not listed',
    r.status === 200 && (r.body?.data?.items || []).length === 0,
    JSON.stringify(r.body?.data)
  );
  r = await alphaBack.call('DELETE', `/api/users/${goneId}`);
  check('deleting an account again is a 404', r.status === 404, `${r.status}`);
  r = await gone.call('GET', '/api/auth/me');
  check('a deleted account loses its open session', r.status === 401, `${r.status} ${JSON.stringify(r.body)}`);
  r = await client('goneLogin').call('POST', '/api/auth/login', { identifier: 'alpha.gone', password: 'GoneUser1!' });
  check(
    'a deleted account cannot sign in',
    r.status === 401 && r.body?.error?.code === 'INVALID_CREDENTIALS',
    JSON.stringify(r.body)
  );
  const goneRow = await prisma.user.findUnique({
    where: { id: goneId },
    select: { deletedAt: true, deletedBy: true, status: true },
  });
  check(
    'the deleted account stays in the database, marked with who deleted it',
    Boolean(goneRow?.deletedAt) && goneRow?.deletedBy === alphaAdminId && goneRow?.status === 'disabled',
    JSON.stringify(goneRow)
  );
  r = await alphaBack.call('POST', '/api/users', {
    username: 'alpha.gone',
    email: 'alpha.gone@example.com',
    role: 'USER',
  });
  check('a deleted account frees its username and email', r.status === 201, JSON.stringify(r.body));

  r = await alphaBack.call('POST', '/api/groups', { name: 'Short lived' });
  check('an admin creates a group to delete', r.status === 201, JSON.stringify(r.body));
  const shortGroupId = r.body?.data?.id;
  r = await alphaBack.call('DELETE', `/api/groups/${shortGroupId}`);
  check('the admin deletes the group', r.status === 200, JSON.stringify(r.body));
  r = await alphaBack.call('GET', `/api/groups/${shortGroupId}`);
  check('a deleted group is a 404', r.status === 404, `${r.status}`);
  const groupRow = await prisma.group.findUnique({
    where: { id: shortGroupId },
    select: { deletedAt: true, deletedBy: true, active: true },
  });
  check(
    'the deleted group stays in the database, inactive',
    Boolean(groupRow?.deletedAt) && groupRow?.deletedBy === alphaAdminId && groupRow?.active === false,
    JSON.stringify(groupRow)
  );
  r = await alphaBack.call('POST', '/api/groups', { name: 'Short lived' });
  check('a deleted group frees its name', r.status === 201, JSON.stringify(r.body));

  r = await alphaBack.call('POST', '/api/roles', { name: 'Short lived role', permissionIds: pids('playbook.read') });
  check('an admin creates a role to delete', r.status === 201, JSON.stringify(r.body));
  const shortRoleId = r.body?.data?.id;
  r = await alphaBack.call('DELETE', `/api/roles/${shortRoleId}`);
  check('the admin deletes the role', r.status === 200, JSON.stringify(r.body));
  r = await alphaBack.call('GET', `/api/roles/${shortRoleId}`);
  check('a deleted role is a 404', r.status === 404, `${r.status}`);
  r = await alphaBack.call('PATCH', `/api/users/${alphaUserId}`, { customRoleId: shortRoleId });
  check('a deleted role cannot be given to anyone', r.status === 404, `${r.status} ${JSON.stringify(r.body)}`);
  const roleRow = await prisma.role.findUnique({
    where: { id: shortRoleId },
    select: { deletedAt: true, deletedBy: true },
  });
  check(
    'the deleted role stays in the database',
    Boolean(roleRow?.deletedAt) && roleRow?.deletedBy === alphaAdminId,
    JSON.stringify(roleRow)
  );
  r = await alphaBack.call('POST', '/api/roles', { name: 'Short lived role', permissionIds: [] });
  check('a deleted role frees its name', r.status === 201, JSON.stringify(r.body));

  r = await owner.call('POST', '/api/platform/companies', {
    name: 'Short Lived Ltd',
    admin: { username: 'short.admin', email: 'short.admin@example.com' },
  });
  check('owner creates a company to delete', r.status === 201, JSON.stringify(r.body));
  const shortCompanyId = r.body?.data?.id;
  r = await owner.call('DELETE', `/api/platform/companies/${shortCompanyId}`);
  check(
    'a company with accounts cannot be deleted',
    r.status === 409 && r.body?.error?.code === 'CONFLICT',
    JSON.stringify(r.body)
  );
  r = await owner.call('GET', '/api/platform/users?search=short.admin');
  const shortAdminId = (r.body?.data?.items || [])[0]?.id;
  r = await owner.call('DELETE', `/api/platform/users/${shortAdminId}`);
  check('owner deletes its administrator', r.status === 200, JSON.stringify(r.body));
  r = await owner.call('DELETE', `/api/platform/companies/${shortCompanyId}`);
  check('a company whose accounts are all deleted can be deleted', r.status === 200, JSON.stringify(r.body));
  r = await owner.call('GET', `/api/platform/companies/${shortCompanyId}`);
  check('a deleted company is a 404', r.status === 404, `${r.status}`);
  r = await owner.call('GET', '/api/platform/companies?search=Short%20Lived');
  check(
    'a deleted company is not listed',
    r.status === 200 && (r.body?.data?.items || []).length === 0,
    JSON.stringify(r.body?.data)
  );
  const companyRow = await prisma.company.findUnique({
    where: { id: shortCompanyId },
    select: { deletedAt: true, active: true },
  });
  check(
    'the deleted company stays in the database',
    Boolean(companyRow?.deletedAt) && companyRow?.active === false,
    JSON.stringify(companyRow)
  );
  r = await owner.call('POST', '/api/platform/companies', {
    name: 'Short Lived Ltd',
    admin: { username: 'short.admin', email: 'short.admin@example.com' },
  });
  check('a deleted company frees its name and its admin’s username', r.status === 201, JSON.stringify(r.body));

  section('Permanent delete');

  r = await alphaBack.call('GET', '/api/auth/me');
  check(
    'a company admin may delete permanently',
    (r.body?.data?.user?.permissions || []).includes('delete.permanent'),
    JSON.stringify(r.body?.data?.user?.permissions)
  );
  r = await alphaBack.call('DELETE', `/api/users/${goneId}?permanent=maybe`);
  check(
    'an unclear permanent flag is refused',
    r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR',
    JSON.stringify(r.body)
  );
  r = await alphaBack.call('DELETE', `/api/users/${goneId}?permanent=true`);
  check(
    'an admin removes an already deleted account for good',
    r.status === 200 && r.body?.data?.permanent === true,
    JSON.stringify(r.body)
  );
  check('its row is gone from the database', (await prisma.user.findUnique({ where: { id: goneId } })) === null);

  r = await alphaBack.call('POST', '/api/users', {
    username: 'alpha.purge',
    email: 'alpha.purge@example.com',
    role: 'USER',
  });
  const purgeId = r.body?.data?.id;
  r = await alphaBack.call('DELETE', `/api/users/${purgeId}?permanent=true`);
  check(
    'an admin removes a live account for good',
    r.status === 200 && (await prisma.user.findUnique({ where: { id: purgeId } })) === null,
    JSON.stringify(r.body)
  );

  r = await alphaBack.call('DELETE', `/api/groups/${shortGroupId}?permanent=true`);
  check(
    'a deleted group can be removed for good',
    r.status === 200 && (await prisma.group.findUnique({ where: { id: shortGroupId } })) === null,
    JSON.stringify(r.body)
  );
  r = await alphaBack.call('DELETE', `/api/roles/${shortRoleId}?permanent=true`);
  check(
    'a deleted role can be removed for good',
    r.status === 200 && (await prisma.role.findUnique({ where: { id: shortRoleId } })) === null,
    JSON.stringify(r.body)
  );
  r = await owner.call('DELETE', `/api/platform/companies/${shortCompanyId}?permanent=true`);
  check(
    'a deleted company can be removed for good',
    r.status === 200 && (await prisma.company.findUnique({ where: { id: shortCompanyId } })) === null,
    JSON.stringify(r.body)
  );

  section('Platform admins');

  r = await owner.call('GET', `/api/platform/roles/assignable?companyId=${companyA}`);
  check(
    'a company account is only offered company roles',
    r.status === 200 &&
      JSON.stringify((r.body?.data?.roles || []).map((x: any) => x.role)) === JSON.stringify(['COMPANY_ADMIN', 'USER']),
    JSON.stringify(r.body?.data)
  );
  r = await owner.call('GET', '/api/platform/roles/assignable');
  check(
    'a platform account is only offered Platform admin',
    r.status === 200 &&
      JSON.stringify((r.body?.data?.roles || []).map((x: any) => x.role)) === JSON.stringify(['PLATFORM_ADMIN']),
    JSON.stringify(r.body?.data)
  );

  r = await owner.call('POST', '/api/platform/users', {
    username: 'second.owner',
    email: 'second.owner@example.com',
    role: 'SUPER_ADMIN',
  });
  check(
    'there is only one platform owner',
    r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR',
    JSON.stringify(r.body)
  );

  r = await owner.call('POST', '/api/platform/users', {
    username: 'platform.helper',
    email: 'platform.helper@example.com',
    role: 'PLATFORM_ADMIN',
  });
  check(
    'the owner creates a platform admin',
    r.status === 201 && r.body?.data?.role === 'PLATFORM_ADMIN' && r.body?.data?.companyId === null,
    JSON.stringify(r.body)
  );
  const helper = client('helper');
  r = await helper.call('POST', '/api/auth/activation', {
    token: activationTokenFrom(latestEmail('platform.helper@example.com')),
    password: 'Helper123!',
  });
  check('the platform admin activates', r.status === 200, JSON.stringify(r.body));
  const helperId = r.body?.data?.user?.id;

  r = await owner.call('POST', '/api/platform/users', {
    username: 'platform.other',
    email: 'platform.other@example.com',
    role: 'PLATFORM_ADMIN',
  });
  const otherHelperId = r.body?.data?.id;

  r = await helper.call('GET', '/api/platform/companies');
  check(
    'a platform admin manages companies',
    r.status === 200 && (r.body?.data?.items || []).length > 0,
    JSON.stringify(r.body?.error)
  );
  r = await helper.call('GET', '/api/platform/users?pageSize=100');
  check(
    'a platform admin does not see platform accounts',
    r.status === 200 &&
      (r.body?.data?.items || []).length > 0 &&
      (r.body?.data?.items || []).every((u: any) => u.role !== 'SUPER_ADMIN' && u.role !== 'PLATFORM_ADMIN'),
    JSON.stringify((r.body?.data?.items || []).map((u: any) => u.role))
  );
  r = await helper.call('GET', `/api/platform/users/${ownerId}`);
  check('nor can it open the owner', r.status === 404, `${r.status}`);
  r = await helper.call('DELETE', `/api/platform/users/${otherHelperId}`);
  check('nor delete another platform admin', r.status === 404, `${r.status}`);
  r = await helper.call('POST', '/api/platform/users', {
    username: 'helper.two',
    email: 'helper.two@example.com',
    role: 'PLATFORM_ADMIN',
  });
  check(
    'a platform admin cannot create platform admins',
    r.status === 403 && r.body?.error?.code === 'INSUFFICIENT_PERMISSION',
    JSON.stringify(r.body)
  );
  r = await helper.call('GET', '/api/platform/roles/assignable');
  check('and is offered no platform role', r.status === 200 && (r.body?.data?.roles || []).length === 0);
  r = await helper.call('PUT', `/api/platform/roles/${systemRoleId('USER')}/permissions`, { permissionIds: [] });
  check('a platform admin cannot change the built-in role defaults', r.status === 403, `${r.status}`);

  r = await helper.call('GET', '/api/audit?pageSize=100');
  check(
    'a platform admin does not see the trail of other platform accounts',
    r.status === 200 && !(r.body?.data?.items || []).some((i: any) => i.detail?.userId === otherHelperId),
    JSON.stringify(r.body?.error)
  );
  r = await owner.call('GET', '/api/audit?pageSize=100');
  check(
    'the owner does',
    (r.body?.data?.items || []).some((i: any) => i.detail?.userId === otherHelperId),
    `${r.status}`
  );
  r = await owner.call('GET', '/api/platform/users?search=platform.');
  check(
    'the owner sees the platform admins',
    r.status === 200 &&
      [helperId, otherHelperId].every((id) => (r.body?.data?.items || []).some((u: any) => u.id === id)),
    JSON.stringify(r.body?.data?.items)
  );
  r = await owner.call('DELETE', `/api/platform/users/${otherHelperId}`);
  check('the owner deletes a platform admin', r.status === 200, JSON.stringify(r.body));

  section('Deleted items');

  const binItems = (res: CallResult) => (res.body?.data?.items || []) as any[];
  const inBin = (res: CallResult, type: string, id: unknown) =>
    binItems(res).find((i: any) => i.type === type && i.id === String(id));

  r = await alphaBack.call('POST', '/api/users', {
    username: 'alpha.binmember',
    email: 'alpha.binmember@example.com',
    role: 'USER',
  });
  const binMember = client('binMember');
  r = await binMember.call('POST', '/api/auth/activation', {
    token: activationTokenFrom(latestEmail('alpha.binmember@example.com')),
    password: 'BinMember1!',
  });
  check('a member for the deleted items checks activates', r.status === 200, JSON.stringify(r.body));
  r = await binMember.call('GET', '/api/deleted-items');
  check(
    'a member cannot open the deleted items',
    r.status === 403 && r.body?.error?.code === 'INSUFFICIENT_PERMISSION',
    JSON.stringify(r.body)
  );

  r = await alphaBack.call('POST', '/api/users', {
    username: 'alpha.bin',
    email: 'alpha.bin@example.com',
    role: 'USER',
  });
  const binUserId = r.body?.data?.id;
  r = await alphaBack.call('POST', '/api/users', {
    username: 'alpha.binactive',
    email: 'alpha.binactive@example.com',
    role: 'USER',
  });
  const binActiveId = r.body?.data?.id;
  r = await client('binActive').call('POST', '/api/auth/activation', {
    token: activationTokenFrom(latestEmail('alpha.binactive@example.com')),
    password: 'BinActive1!',
  });
  r = await alphaBack.call('POST', '/api/groups', { name: 'Bin group' });
  const binGroupId = r.body?.data?.id;
  r = await alphaBack.call('POST', '/api/roles', { name: 'Bin role', permissionIds: [] });
  const binRoleId = r.body?.data?.id;
  for (const path of [
    `/api/users/${binUserId}`,
    `/api/users/${binActiveId}`,
    `/api/groups/${binGroupId}`,
    `/api/roles/${binRoleId}`,
  ]) {
    r = await alphaBack.call('DELETE', path);
  }

  r = await alphaBack.call('GET', '/api/deleted-items?pageSize=100');
  const binUser = inBin(r, 'user', binUserId);
  check(
    'a company admin sees what was deleted in their company',
    r.status === 200 && binUser && inBin(r, 'group', binGroupId) && inBin(r, 'role', binRoleId),
    JSON.stringify(r.body)
  );
  check(
    'with when and by whom',
    Boolean(binUser?.deletedAt) && binUser?.deletedBy?.id === alphaAdminId && Boolean(binUser?.deletedBy?.name),
    JSON.stringify(binUser)
  );
  check(
    'and only their own company',
    binItems(r).every((i: any) => i.companyId === companyA && i.type !== 'company'),
    JSON.stringify(binItems(r).map((i: any) => [i.type, i.companyId]))
  );
  r = await alphaBack.call('GET', '/api/deleted-items?type=group&pageSize=100');
  check(
    'the list filters by type',
    r.status === 200 && binItems(r).length > 0 && binItems(r).every((i: any) => i.type === 'group'),
    JSON.stringify(binItems(r).map((i: any) => i.type))
  );
  r = await alphaBack.call('GET', '/api/deleted-items?search=binactive');
  check(
    'and searches',
    r.status === 200 && binItems(r).length === 1 && binItems(r)[0].id === String(binActiveId),
    JSON.stringify(binItems(r))
  );
  r = await alphaBack.call('GET', '/api/deleted-items?type=dashboard');
  check('an unknown type is refused', r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR', `${r.status}`);

  const betaBin = client('betaBin');
  r = await betaBin.call('POST', '/api/auth/login', { identifier: 'beta.admin', password: 'BetaAdmin1!' });
  r = await betaBin.call('GET', '/api/deleted-items?pageSize=100');
  check(
    "another company's admin does not see them",
    r.status === 200 && !inBin(r, 'user', binUserId) && !inBin(r, 'group', binGroupId),
    `${r.status} ${JSON.stringify(binItems(r).map((i: any) => i.companyId))}`
  );
  r = await betaBin.call('POST', `/api/deleted-items/group/${binGroupId}/restore`);
  check('nor recover them', r.status === 404, `${r.status}`);

  r = await helper.call('GET', '/api/deleted-items?pageSize=100');
  check(
    'a platform admin sees the deleted items of every company',
    r.status === 200 && inBin(r, 'user', binUserId) && inBin(r, 'group', binGroupId),
    JSON.stringify(r.body?.error)
  );
  check('but not deleted platform accounts', !inBin(r, 'user', otherHelperId));
  r = await helper.call('GET', `/api/deleted-items?companyId=${companyB}&pageSize=100`);
  check(
    'and can narrow them to one company',
    r.status === 200 && binItems(r).every((i: any) => i.companyId === companyB),
    JSON.stringify(binItems(r).map((i: any) => i.companyId))
  );
  r = await owner.call('GET', '/api/deleted-items?type=user&pageSize=100');
  check('the owner also sees deleted platform accounts', Boolean(inBin(r, 'user', otherHelperId)));

  r = await alphaBack.call('POST', `/api/deleted-items/user/${binUserId}/restore`);
  check(
    'a deleted account is recovered',
    r.status === 200 && r.body?.data?.restored === true && r.body?.data?.item?.id === String(binUserId),
    JSON.stringify(r.body)
  );
  r = await alphaBack.call('GET', `/api/users/${binUserId}`);
  check(
    'back among the members, still invited since it never chose a password',
    r.status === 200 && r.body?.data?.status === 'pending',
    JSON.stringify(r.body?.data)
  );
  r = await alphaBack.call('POST', `/api/deleted-items/user/${binActiveId}/restore`);
  r = await alphaBack.call('GET', `/api/users/${binActiveId}`);
  check(
    'an activated account comes back deactivated',
    r.status === 200 && r.body?.data?.status === 'disabled',
    JSON.stringify(r.body?.data)
  );
  r = await alphaBack.call('POST', `/api/users/${binActiveId}/activate`);
  check('and can be reactivated', r.status === 200 && r.body?.data?.status === 'active', JSON.stringify(r.body));
  r = await alphaBack.call('POST', `/api/deleted-items/user/${binUserId}/restore`);
  check('recovering it twice is a 404', r.status === 404, `${r.status}`);

  r = await alphaBack.call('POST', `/api/deleted-items/group/${binGroupId}/restore`);
  check('a deleted group is recovered', r.status === 200, JSON.stringify(r.body));
  r = await alphaBack.call('GET', `/api/groups/${binGroupId}`);
  check('it comes back paused', r.status === 200 && r.body?.data?.active === false, JSON.stringify(r.body?.data));

  r = await alphaBack.call('POST', '/api/roles', { name: 'Bin role', permissionIds: [] });
  check('a new role takes the deleted role’s name', r.status === 201, JSON.stringify(r.body));
  r = await alphaBack.call('POST', `/api/deleted-items/role/${binRoleId}/restore`);
  check(
    'so the deleted role cannot come back under it',
    r.status === 409 && r.body?.error?.code === 'CONFLICT',
    JSON.stringify(r.body)
  );
  r = await alphaBack.call('DELETE', `/api/deleted-items/role/${binRoleId}`);
  check(
    'a deleted item is removed for good',
    r.status === 200 &&
      r.body?.data?.permanent === true &&
      (await prisma.role.findUnique({ where: { id: binRoleId } })) === null,
    JSON.stringify(r.body)
  );
  r = await alphaBack.call('GET', '/api/deleted-items?pageSize=100');
  check('and leaves the deleted items', r.status === 200 && !inBin(r, 'role', binRoleId));
  r = await alphaBack.call('DELETE', `/api/deleted-items/group/${binGroupId}`);
  check('a live record is not in the deleted items', r.status === 404, `${r.status}`);

  r = await owner.call('POST', '/api/platform/companies', {
    name: 'Bin Company',
    admin: { username: 'bin.admin', email: 'bin.admin@example.com' },
  });
  const binCompanyId = r.body?.data?.id;
  r = await owner.call('GET', '/api/platform/users?search=bin.admin');
  const binAdminId = binItems(r)[0]?.id;
  await owner.call('DELETE', `/api/platform/users/${binAdminId}`);
  r = await owner.call('DELETE', `/api/platform/companies/${binCompanyId}`);
  check('a company is deleted for the deleted items checks', r.status === 200, JSON.stringify(r.body));
  r = await helper.call('GET', '/api/deleted-items?pageSize=100');
  check(
    'a deleted company is listed, its accounts are not',
    Boolean(inBin(r, 'company', binCompanyId)) && !inBin(r, 'user', binAdminId),
    JSON.stringify(binItems(r).map((i: any) => [i.type, i.name]))
  );
  r = await alphaBack.call('POST', `/api/deleted-items/company/${binCompanyId}/restore`);
  check('a company admin cannot recover a company', r.status === 404, `${r.status}`);
  r = await helper.call('POST', `/api/deleted-items/company/${binCompanyId}/restore`);
  check('a platform admin recovers it', r.status === 200, JSON.stringify(r.body));
  r = await owner.call('GET', `/api/platform/companies/${binCompanyId}`);
  check('it comes back suspended', r.status === 200 && r.body?.data?.active === false, JSON.stringify(r.body?.data));
  const binCompanyRoles = await prisma.role.findMany({
    where: { companyId: binCompanyId },
    select: { deletedAt: true },
  });
  check(
    'with what was deleted together with it',
    binCompanyRoles.length > 0 && binCompanyRoles.every((role) => role.deletedAt === null),
    JSON.stringify(binCompanyRoles)
  );
  r = await helper.call('GET', '/api/deleted-items?type=user&search=bin.admin');
  check('its deleted accounts can now be recovered one by one', Boolean(inBin(r, 'user', binAdminId)));
  await owner.call('DELETE', `/api/platform/companies/${binCompanyId}`);
  r = await owner.call('DELETE', `/api/deleted-items/company/${binCompanyId}`);
  check(
    'a deleted company is removed for good, with its deleted accounts',
    r.status === 200 &&
      (await prisma.company.findUnique({ where: { id: binCompanyId } })) === null &&
      (await prisma.user.findUnique({ where: { id: binAdminId } })) === null,
    JSON.stringify(r.body)
  );

  let restoredEvent = null;
  for (let attempt = 0; attempt < 20 && !restoredEvent; attempt++) {
    restoredEvent = await prisma.auditLog.findFirst({ where: { event: 'user_restored' } });
    if (!restoredEvent) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  check('recovering is on the audit trail', restoredEvent !== null);

  section('Hidden features stay out of responses');

  r = await owner.call('GET', '/api/platform/roles/permissions');
  check(
    'the built-in role grid leaves out hidden permissions',
    r.status === 200 &&
      !(r.body?.data || []).some((p: any) => /^(dashboard|data|access|scope|agent)\./.test(p.key)) &&
      (r.body?.data || []).some((p: any) => p.key === 'delete.permanent'),
    JSON.stringify((r.body?.data || []).map((p: any) => p.key))
  );
  r = await owner.call('GET', '/api/platform/overview');
  check(
    'the platform overview has no dashboard counts',
    r.status === 200 && r.body?.data?.dashboards === undefined && r.body?.data?.assignments === undefined,
    JSON.stringify(r.body?.data)
  );
  r = await owner.call('GET', '/api/platform/companies');
  check(
    'company rows have no dashboard count',
    r.status === 200 && (r.body?.data?.items || []).every((c: any) => c.dashboardCount === undefined),
    JSON.stringify(r.body?.data?.items?.[0])
  );
  r = await alphaBack.call('GET', '/api/workspace/overview');
  check(
    'the workspace overview has no dashboard counts',
    r.status === 200 && r.body?.data?.dashboards === undefined && r.body?.data?.dashboardsGranted === undefined,
    JSON.stringify(r.body?.data)
  );
  r = await owner.call('GET', '/api/audit?category=dashboards');
  check(
    'the hidden audit category answers nothing',
    r.status === 200 && (r.body?.data?.items || []).length === 0,
    JSON.stringify(r.body)
  );

  section('Forgot password');

  r = await owner.call('POST', '/api/platform/users', {
    companyId: companyA,
    username: 'alpha.reset',
    email: 'alpha.reset@example.com',
    role: 'USER',
  });
  check('owner creates an account to reset', r.status === 201, JSON.stringify(r.body));
  const resetUser = client('resetUser');
  r = await resetUser.call('POST', '/api/auth/activation', {
    token: activationTokenFrom(latestEmail('alpha.reset@example.com')),
    password: 'ResetMe1!',
  });
  check('the account to reset activates', r.status === 200, JSON.stringify(r.body));

  r = await owner.call('POST', '/api/platform/users', {
    companyId: companyA,
    username: 'alpha.pending',
    email: 'alpha.pending@example.com',
    role: 'USER',
  });
  check('owner creates an account that stays pending', r.status === 201, JSON.stringify(r.body));
  const pendingMails = mailCount('alpha.pending@example.com');

  const forgetful = client('forgetful');
  r = await forgetful.call('POST', '/api/auth/forgot-password', {});
  check(
    'forgot password needs a username or email',
    r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR',
    JSON.stringify(r.body)
  );

  let resetMails = mailCount('alpha.reset@example.com');
  r = await forgetful.call('POST', '/api/auth/forgot-password', { identifier: 'alpha.reset@example.com' });
  check(
    'forgot password is accepted',
    r.status === 200 && typeof r.body?.data?.message === 'string',
    JSON.stringify(r.body)
  );
  const acceptedMessage = r.body?.data?.message;
  const firstMail = await nextEmail('alpha.reset@example.com', resetMails);
  const firstReset = resetTokenFrom(firstMail);
  check('a reset link is emailed', Boolean(firstReset), firstMail ?? 'no email arrived');

  r = await forgetful.call('POST', '/api/auth/forgot-password', { identifier: 'nobody.here' });
  check(
    'an unknown account gets the same answer',
    r.status === 200 && r.body?.data?.message === acceptedMessage,
    JSON.stringify(r.body)
  );

  r = await forgetful.call('POST', '/api/auth/forgot-password', { identifier: 'alpha.pending' });
  check(
    'a pending account gets the same answer',
    r.status === 200 && r.body?.data?.message === acceptedMessage,
    JSON.stringify(r.body)
  );

  r = await forgetful.call('GET', '/api/auth/reset-password?token=not-a-real-token');
  check(
    'an unknown reset link is refused',
    r.status === 400 && r.body?.error?.code === 'INVALID_RESET_TOKEN',
    JSON.stringify(r.body)
  );

  r = await forgetful.call('GET', `/api/auth/reset-password?token=${encodeURIComponent(firstReset!)}`);
  check(
    'the reset link describes the account',
    r.status === 200 && r.body?.data?.username === 'alpha.reset',
    JSON.stringify(r.body)
  );

  r = await forgetful.call('POST', '/api/auth/reset-password', { token: firstReset, password: 'short' });
  check(
    'a weak new password is refused',
    r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR',
    JSON.stringify(r.body)
  );

  resetMails = mailCount('alpha.reset@example.com');
  r = await forgetful.call('POST', '/api/auth/forgot-password', { identifier: 'alpha.reset@example.com' });
  check('a second request is accepted', r.status === 200, JSON.stringify(r.body));
  const secondReset = resetTokenFrom(await nextEmail('alpha.reset@example.com', resetMails));
  check('a second reset link is emailed', Boolean(secondReset) && secondReset !== firstReset);

  r = await forgetful.call('POST', '/api/auth/reset-password', { token: firstReset, password: 'ResetDone1!' });
  check(
    'a newer link replaces the earlier one',
    r.status === 400 && r.body?.error?.code === 'INVALID_RESET_TOKEN',
    JSON.stringify(r.body)
  );

  r = await forgetful.call('POST', '/api/auth/reset-password', { token: secondReset, password: 'ResetDone1!' });
  check(
    'the reset sets the password and signs in',
    r.status === 200 && r.body?.data?.state === 'AUTHENTICATED' && forgetful.cookies.has('da_access'),
    JSON.stringify(r.body)
  );

  r = await forgetful.call('POST', '/api/auth/reset-password', { token: secondReset, password: 'ResetAgain1!' });
  check(
    'a reset link is single use',
    r.status === 400 && r.body?.error?.code === 'INVALID_RESET_TOKEN',
    JSON.stringify(r.body)
  );

  r = await resetUser.call('POST', '/api/auth/refresh');
  check('the reset ends earlier sessions', r.status === 401, `${r.status} ${JSON.stringify(r.body)}`);

  const relogin = client('relogin');
  r = await relogin.call('POST', '/api/auth/login', { identifier: 'alpha.reset', password: 'ResetMe1!' });
  check(
    'the old password stops working',
    r.status === 401 && r.body?.error?.code === 'INVALID_CREDENTIALS',
    JSON.stringify(r.body)
  );
  r = await relogin.call('POST', '/api/auth/login', { identifier: 'alpha.reset', password: 'ResetDone1!' });
  check('the new password signs in', r.status === 200, JSON.stringify(r.body));

  resetMails = mailCount('alpha.reset@example.com');
  r = await forgetful.call('POST', '/api/auth/forgot-password', { identifier: 'alpha.reset@example.com' });
  check('a third request in the hour is accepted', r.status === 200, JSON.stringify(r.body));
  check('a third reset link is emailed', Boolean(await nextEmail('alpha.reset@example.com', resetMails)));

  r = await forgetful.call('POST', '/api/auth/forgot-password', { identifier: 'alpha.reset@example.com' });
  check(
    'a fourth request in the hour is refused with a message',
    r.status === 429 && r.body?.error?.code === 'RATE_LIMITED' && /minute/.test(r.body?.error?.message || ''),
    JSON.stringify(r.body)
  );

  await forgetful.call('POST', '/api/auth/forgot-password', { identifier: 'nobody.here' });
  await forgetful.call('POST', '/api/auth/forgot-password', { identifier: 'nobody.here' });
  r = await forgetful.call('POST', '/api/auth/forgot-password', { identifier: 'nobody.here' });
  check(
    'the limit applies to unknown accounts too',
    r.status === 429 && r.body?.error?.code === 'RATE_LIMITED',
    JSON.stringify(r.body)
  );

  resetMails = mailCount('alpha.reset@example.com');
  r = await forgetful.call('POST', '/api/auth/forgot-password', { identifier: 'alpha.reset' });
  check('asking by username after the limit is still answered', r.status === 200, JSON.stringify(r.body));
  check(
    'an account is sent at most three links an hour',
    (await nextEmail('alpha.reset@example.com', resetMails, 1500)) === null
  );
  check('a pending account is sent no reset link', mailCount('alpha.pending@example.com') === pendingMails);

  r = await owner.call('GET', '/api/audit?event=password_reset');
  check(
    'the reset is in the audit trail',
    r.status === 200 && (r.body?.data?.items || []).length >= 1,
    `${r.status} ${JSON.stringify(r.body)}`
  );

  section('Unauthenticated and malformed requests');

  const anon = client('anon');
  for (const [method, url] of [
    ['GET', '/api/dashboard/default'],
    ['GET', '/api/users'],
    ['GET', '/api/groups'],
    ['GET', '/api/workspace/company'],
    ['GET', '/api/platform/companies'],
    ['GET', '/api/platform/users'],
    ['GET', '/api/audit'],
    ['GET', '/api/dashboard/columns?dashboardId=default'],
    ['POST', '/api/dashboard/preview'],
  ]) {
    r = await anon.call(method, url, method === 'POST' ? {} : undefined, { noAuth: true });
    check(`anonymous ${method} ${url} is refused`, r.status === 401, `${r.status} ${JSON.stringify(r.body)}`);
  }

  r = await anon.call('POST', '/api/auth/login', { identifier: 'alpha.admin', password: 'wrong' }, { noAuth: true });
  check('wrong password gives INVALID_CREDENTIALS', r.status === 401 && r.body?.error?.code === 'INVALID_CREDENTIALS');
  r = await anon.call('POST', '/api/auth/login', { identifier: 'nobody.here', password: 'wrong' }, { noAuth: true });
  check('unknown account gives the same answer', r.status === 401 && r.body?.error?.code === 'INVALID_CREDENTIALS');

  r = await anon.call('GET', '/api/nope', undefined, { noAuth: true });
  check(
    'unknown endpoint is a structured 404',
    r.status === 404 && r.body?.success === false && r.body?.error?.code === 'RESOURCE_NOT_FOUND'
  );

  r = await owner.call('GET', '/api/platform/users/abc');
  check(
    'an id that is not a UUID is a validation error',
    r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR'
  );

  await sink!.stop();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed ? 1 : 0);
})().catch(async (err: unknown) => {
  if (sink) await sink.stop().catch(() => {});
  console.error('\nHARNESS ERROR:', err);
  process.exit(2);
});
