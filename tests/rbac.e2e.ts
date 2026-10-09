import { startSmtpSink } from './smtpSink';
import type { SmtpSink } from './smtpSink';
import { createReportingFixture } from './reportingFixture';
import config from '../src/config';
const { BOOTSTRAP_SUPERADMIN } = config.app;
const { APPLICATION_URL } = config.auth;

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
        if (value === '' ) this.cookies.delete(name);
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
      if (text) { try { json = JSON.parse(text); } catch { json = null; } }
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

(async () => {
  sink = await startSmtpSink({ port: SINK_PORT });
  console.log(`SMTP sink listening on 127.0.0.1:${SINK_PORT}`);

  const fixture = await createReportingFixture();
  console.log(`reporting fixture: ${fixture.schema}.${fixture.table}, ${fixture.rows} rows`);

  const boot = BOOTSTRAP_SUPERADMIN;

  section('Platform owner: first sign-in requires a password change');

  const owner = client('owner');
  let r = await owner.call('POST', '/api/auth/login', {
    identifier: boot.username,
    password: boot.password,
  });
  check('login succeeds', r.status === 200, JSON.stringify(r.body));
  check('state is PASSWORD_CHANGE_REQUIRED', r.body?.data?.state === 'PASSWORD_CHANGE_REQUIRED');
  check('response carries no token of any kind', !/token/i.test(Object.keys(r.body?.data || {}).join(',')), JSON.stringify(Object.keys(r.body?.data || {})));
  check('refresh cookie was set', owner.cookies.has('da_refresh'));
  check('access cookie was set', owner.cookies.has('da_access'));
  owner.adopt(r.body.data);

  r = await owner.call('GET', '/api/platform/companies');
  check('blocked from other endpoints until the change', r.status === 403 && r.body?.error?.code === 'PASSWORD_CHANGE_REQUIRED', JSON.stringify(r.body));

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
  check('company without an administrator is refused', r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR', JSON.stringify(r.body));

  r = await owner.call('POST', '/api/platform/companies', {
    name: 'Alpha Industries',
    admin: { username: 'alpha.admin', email: 'alpha.admin@example.com', displayName: 'Alpha Admin' },
  });
  check('creates company A', r.status === 201, JSON.stringify(r.body));
  const companyA = r.body?.data?.id;
  check('creates company A administrator with it', r.body?.data?.admin?.username === 'alpha.admin', JSON.stringify(r.body?.data));
  check('the administrator holds COMPANY_ADMIN', r.body?.data?.admin?.role === 'COMPANY_ADMIN');
  check('the administrator belongs to the new company', r.body?.data?.admin?.companyId === companyA);
  check('new account is pending', r.body?.data?.admin?.status === 'pending');
  check('response contains no password field', !JSON.stringify(r.body).includes('password_hash') && !('password' in (r.body?.data?.admin || {})));

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
  check('duplicate administrator is refused', r.status === 409 && r.body?.error?.code === 'CONFLICT', JSON.stringify(r.body));

  r = await owner.call('GET', '/api/platform/companies');
  check('the rejected company was not created', !(r.body?.data?.items || []).some((c: any) => c.name === 'Rollback Test Ltd'), JSON.stringify(r.body));

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
  check('activation link describes the account', r.status === 200 && r.body?.data?.username === 'alpha.admin', JSON.stringify(r.body));

  r = await alphaAdmin.call('POST', '/api/auth/activation', { token: alphaToken, password: 'short' });
  check('weak password is rejected', r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR');

  r = await alphaAdmin.call('POST', '/api/auth/activation', { token: alphaToken, password: 'AlphaAdmin1!' });
  check('activation sets the password and signs in', r.status === 200 && r.body?.data?.state === 'AUTHENTICATED', JSON.stringify(r.body));
  alphaAdmin.adopt(r.body.data);

  const replay = client('replay');
  r = await replay.call('POST', '/api/auth/activation', { token: alphaToken, password: 'Another1!' });
  check('activation link is single use', r.status === 400 && r.body?.error?.code === 'INVALID_ACTIVATION_TOKEN', JSON.stringify(r.body));

  section('Company administrator: scoped to their own company');

  r = await alphaAdmin.call('GET', '/api/users?pageSize=100');
  const alphaDirectory = r.body?.data?.items || [];
  check('sees only their company', r.status === 200 && alphaDirectory.length > 0 && !alphaDirectory.some((u: any) => u.username.startsWith('beta.')) && !alphaDirectory.some((u: any) => 'companyName' in u), JSON.stringify(alphaDirectory.map((u: any) => u.username)));

  r = await alphaAdmin.call('GET', `/api/users?companyId=${companyB}&pageSize=100`);
  check('companyId cannot widen a company caller', r.status === 200 && !(r.body?.data?.items || []).some((u: any) => u.username.startsWith('beta.')), JSON.stringify(r.body?.data));

  r = await alphaAdmin.call('GET', '/api/users?search=beta');
  check('search stays inside the company', r.status === 200 && r.body?.data?.total === 0, JSON.stringify(r.body?.data));

  r = await alphaAdmin.call('GET', '/api/users?sort=password_hash');
  check('an unknown sort key is refused', r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR', JSON.stringify(r.body));

  r = await alphaAdmin.call('GET', '/api/users?pageSize=1');
  check('a page holds pageSize rows and the total counts all', r.status === 200 && r.body?.data?.items?.length === 1 && r.body?.data?.total === alphaDirectory.length, JSON.stringify(r.body?.data));

  r = await alphaAdmin.call('GET', '/api/workspace/company');
  check('reads their own company', r.status === 200 && r.body.data?.id === companyA, JSON.stringify(r.body));

  r = await alphaAdmin.call('GET', '/api/workspace/overview');
  check('own-company counts are scoped to them', r.status === 200 && r.body.data?.users === alphaDirectory.length, JSON.stringify(r.body));

  r = await alphaAdmin.call('GET', '/api/platform/companies');
  check('cannot list every company', r.status === 403 && r.body?.error?.code === 'TENANT_ACCESS_DENIED', JSON.stringify(r.body));

  r = await alphaAdmin.call('POST', '/api/platform/companies', { name: 'Sneaky Ltd' });
  check('cannot create a company', r.status === 403 && r.body?.error?.code === 'TENANT_ACCESS_DENIED', JSON.stringify(r.body));

  r = await alphaAdmin.call('GET', '/api/platform/users');
  check('cannot read the cross-tenant directory', r.status === 403 && r.body?.error?.code === 'TENANT_ACCESS_DENIED', JSON.stringify(r.body));

  r = await alphaAdmin.call('POST', '/api/users', {
    username: 'alpha.user', email: 'alpha.user@example.com', role: 'USER',
  });
  check('creates a user in their company', r.status === 201, JSON.stringify(r.body));
  const alphaUserId = r.body?.data?.id;
  check('created user is placed in the admin company', r.body?.data?.companyId === companyA);

  r = await alphaAdmin.call('POST', '/api/users', {
    companyId: companyB, username: 'cross.user', email: 'cross@example.com', role: 'USER',
  });
  check('companyId in the body is ignored, not honoured', r.status === 201 && r.body?.data?.companyId === companyA, JSON.stringify(r.body?.data));
  const ignoredId = r.body?.data?.id;
  if (ignoredId) await alphaAdmin.call('DELETE', `/api/users/${ignoredId}`);

  r = await alphaAdmin.call('POST', '/api/users', {
    username: 'wannabe', email: 'wannabe@example.com', role: 'SUPER_ADMIN',
  });
  check('cannot create a SUPER_ADMIN', r.status === 403 && r.body?.error?.code === 'INSUFFICIENT_PERMISSION', JSON.stringify(r.body));

  r = await owner.call('GET', `/api/platform/users?companyId=${companyB}&search=beta.admin`);
  const betaAdminId = r.body.data.items.find((u: any) => u.username === 'beta.admin').id;

  r = await alphaAdmin.call('GET', `/api/users/${betaAdminId}`);
  check('another company\u2019s user is a 404, not a 403', r.status === 404 && r.body?.error?.code === 'RESOURCE_NOT_FOUND', JSON.stringify(r.body));

  r = await alphaAdmin.call('PATCH', `/api/users/${betaAdminId}`, { role: 'USER' });
  check('cannot modify another company\u2019s user', r.status === 404, JSON.stringify(r.body));

  r = await alphaAdmin.call('DELETE', `/api/users/${betaAdminId}`);
  check('cannot delete another company\u2019s user', r.status === 404);

  r = await owner.call('GET', '/api/platform/users?role=SUPER_ADMIN');
  const ownerId = r.body.data.items.find((u: any) => u.role === 'SUPER_ADMIN').id;
  r = await alphaAdmin.call('PATCH', `/api/users/${ownerId}`, { role: 'USER' });
  check('cannot manage the platform owner', r.status === 404 || r.status === 403, `${r.status} ${JSON.stringify(r.body)}`);

  section('Dashboard access and tenant isolation of data');

  r = await alphaAdmin.call('GET', '/api/access/dashboards');
  check('admin sees the assigned dashboard', r.status === 200 && r.body.data.some((d: any) => d.id === 'default'), JSON.stringify(r.body?.data));

  r = await alphaAdmin.call('PUT', `/api/access/dashboards/default/users/${alphaUserId}`, { level: 'view' });
  check('grants the dashboard to their user', r.status === 200, JSON.stringify(r.body));

  const betaAdmin = client('betaAdmin');
  const betaToken = activationTokenFrom(latestEmail('beta.admin@example.com'));
  r = await betaAdmin.call('POST', '/api/auth/activation', { token: betaToken, password: 'BetaAdmin1!' });
  check('company B administrator activates', r.status === 200, JSON.stringify(r.body));
  betaAdmin.adopt(r.body.data);

  r = await betaAdmin.call('GET', '/api/dashboard/default');
  check('company B cannot read the unassigned dashboard', r.status === 404 && r.body?.error?.code === 'DASHBOARD_NOT_FOUND', `${r.status} ${JSON.stringify(r.body)}`);

  r = await betaAdmin.call('GET', '/api/access/dashboards');
  check('company B has no dashboards listed', r.status === 200 && r.body.data.length === 0);

  r = await betaAdmin.call('PUT', `/api/access/dashboards/default/users/${alphaUserId}`, { level: 'admin' });
  check('company B cannot grant company A\u2019s user', r.status === 404, `${r.status} ${JSON.stringify(r.body)}`);

  section('Plain user: least privilege');

  const alphaUser = client('alphaUser');
  const userToken = activationTokenFrom(latestEmail('alpha.user@example.com'));
  r = await alphaUser.call('POST', '/api/auth/activation', { token: userToken, password: 'AlphaUser1!' });
  check('user activates and is signed in', r.status === 200, JSON.stringify(r.body));
  alphaUser.adopt(r.body.data);

  r = await alphaUser.call('GET', '/api/dashboard/default');
  check('user reads the granted dashboard', r.status === 200 && Array.isArray(r.body?.data?.cards), `${r.status} ${JSON.stringify(r.body?.error)}`);
  check('dashboard view still has cards and slicers', (r.body?.data?.cards || []).length > 0 && Array.isArray(r.body?.data?.slicers));

  r = await alphaUser.call('GET', '/api/users');
  check('user cannot list users', r.status === 403 && r.body?.error?.code === 'INSUFFICIENT_PERMISSION');

  r = await alphaUser.call('POST', '/api/users', { username: 'x.y', email: 'x@y.com', role: 'USER' });
  check('user cannot create users', r.status === 403);

  r = await alphaUser.call('GET', '/api/workspace/company');
  check('user cannot read their own company either', r.status === 403 && r.body?.error?.code === 'INSUFFICIENT_PERMISSION', JSON.stringify(r.body));

  r = await alphaUser.call('GET', '/api/platform/companies');
  check('user cannot reach the platform namespace', r.status === 403 && r.body?.error?.code === 'TENANT_ACCESS_DENIED', JSON.stringify(r.body));

  r = await alphaUser.call('PUT', '/api/platform/roles/USER/permissions', { permissions: [] });
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

  r = await alphaAdmin.call('PUT', `/api/access/dashboards/default/groups/${betaGroupId}`, { level: 'admin' });
  check('another company’s group cannot be granted', r.status === 404, JSON.stringify(r.body));

  await alphaAdmin.call('DELETE', `/api/access/dashboards/default/users/${alphaUserId}`);
  r = await alphaUser.call('GET', '/api/access/dashboards');
  check('the direct grant is gone', r.status === 200 && r.body.data.length === 0, JSON.stringify(r.body?.data));

  r = await alphaAdmin.call('PUT', `/api/access/dashboards/default/groups/${groupId}`, { level: 'view' });
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
  check('a deactivated group stops passing access on', r.status === 404, `${r.status} ${JSON.stringify(r.body?.error)}`);

  await alphaAdmin.call('PUT', `/api/groups/${groupId}`, { active: true });
  r = await alphaUser.call('GET', '/api/dashboard/default');
  check('reactivating the group restores it', r.status === 200, `${r.status}`);

  r = await alphaAdmin.call('DELETE', `/api/groups/${groupId}`);
  check('the group can be deleted', r.status === 200, JSON.stringify(r.body));
  r = await alphaUser.call('GET', '/api/dashboard/default');
  check('deleting the group takes the inherited access with it', r.status === 404, `${r.status}`);

  await alphaAdmin.call('PUT', `/api/access/dashboards/default/users/${alphaUserId}`, { level: 'view' });

  section('Role permissions and the platform boundary');

  r = await owner.call('PUT', '/api/platform/roles/COMPANY_ADMIN/permissions', {
    permissions: ['user.read', 'company.create'],
  });
  check('a company role cannot be given a platform permission', r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR', JSON.stringify(r.body));

  r = await owner.call('PUT', '/api/platform/roles/SUPER_ADMIN/permissions', { permissions: [] });
  check('SUPER_ADMIN permissions cannot be edited', r.status === 400, JSON.stringify(r.body));

  r = await owner.call('PUT', '/api/platform/roles/USER/permissions', { permissions: ['dashboard.read', 'data.read'] });
  check('USER permissions can be edited', r.status === 200, JSON.stringify(r.body));

  section('Company features: set by the platform owner, a ceiling on every role');

  r = await owner.call('GET', '/api/platform/features');
  check('the platform lists the features', r.status === 200 && (r.body?.data || []).some((f: any) => f.id === 'metadata_lakehouse' && f.locked), JSON.stringify(r.body));

  r = await owner.call('GET', `/api/platform/companies/${companyA}/features`);
  check('a company created without a list has every feature', r.status === 200 && (r.body?.data?.features || []).every((f: any) => f.enabled), JSON.stringify(r.body));

  r = await owner.call('POST', '/api/platform/companies', {
    name: 'Gamma Labs',
    features: ['agents'],
    admin: { username: 'gamma.admin', email: 'gamma.admin@example.com' },
  });
  const companyC = r.body?.data?.id;
  check('a company can be created with chosen features', r.status === 201
    && JSON.stringify(r.body?.data?.features) === JSON.stringify(['metadata_lakehouse', 'agents']), JSON.stringify(r.body?.data));

  r = await owner.call('POST', '/api/platform/companies', {
    name: 'Bad Feature Co',
    features: ['teleport'],
    admin: { username: 'bad.feature', email: 'bad.feature@example.com' },
  });
  check('an unknown feature is refused', r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR', JSON.stringify(r.body));

  r = await alphaAdmin.call('PUT', `/api/platform/companies/${companyA}/features`, { features: [] });
  check('a company admin cannot change features', r.status === 403, JSON.stringify(r.body));

  r = await owner.call('PUT', `/api/platform/companies/${companyA}/features`, { features: ['data_analyst', 'agents'] });
  check('the platform owner switches Dashboards off', r.status === 200
    && !(r.body?.data?.features || []).find((f: any) => f.id === 'dashboards')?.enabled, JSON.stringify(r.body));

  r = await alphaUser.call('GET', '/api/dashboard/default');
  check('a disabled feature is refused on the next request', r.status === 403 && r.body?.error?.code === 'FEATURE_NOT_ENABLED', `${r.status} ${JSON.stringify(r.body?.error)}`);

  r = await alphaAdmin.call('GET', '/api/auth/me');
  check('the session reports the features and masks the permissions',
    r.status === 200
      && !(r.body?.data?.user?.features || []).includes('dashboards')
      && (r.body?.data?.user?.features || []).includes('metadata_lakehouse')
      && !(r.body?.data?.user?.permissions || []).includes('dashboard.read')
      && (r.body?.data?.user?.permissions || []).includes('user.read'),
    JSON.stringify(r.body?.data?.user));

  r = await owner.call('PUT', `/api/platform/companies/${companyA}/features`, { features: ['data_analyst', 'agents', 'dashboards'] });
  check('switching it back on is accepted', r.status === 200, JSON.stringify(r.body));
  r = await alphaUser.call('GET', '/api/dashboard/default');
  check('switching it back on restores access exactly', r.status === 200, `${r.status} ${JSON.stringify(r.body?.error)}`);

  section('Company roles: created by the company admin');

  r = await alphaAdmin.call('POST', '/api/roles', { name: 'Analyst', permissions: ['dashboard.update', 'agent.create'] });
  const analystRoleId = r.body?.data?.id;
  check('a company admin creates a role', r.status === 201, JSON.stringify(r.body));
  check('Create/Edit imply View', ['dashboard.read', 'dashboard.update', 'agent.read', 'agent.create'].every((p) => (r.body?.data?.permissions || []).includes(p)), JSON.stringify(r.body?.data));

  r = await alphaAdmin.call('POST', '/api/roles', { name: 'Analyst', permissions: [] });
  check('a duplicate role name is refused', r.status === 409, JSON.stringify(r.body));
  r = await alphaAdmin.call('POST', '/api/roles', { name: 'Company Admin', permissions: [] });
  check('a built-in role name is refused', r.status === 400, JSON.stringify(r.body));
  r = await alphaAdmin.call('POST', '/api/roles', { name: 'People', permissions: ['user.create'] });
  check('a custom role cannot manage people', r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR', JSON.stringify(r.body));
  r = await alphaAdmin.call('POST', '/api/roles', { name: 'Owner', permissions: ['company.features'] });
  check('a custom role cannot hold a platform permission', r.status === 400, JSON.stringify(r.body));

  r = await owner.call('POST', '/api/roles', { companyId: companyC, name: 'Dash', permissions: ['dashboard.read'] });
  check('a role cannot hold a feature its company lacks', r.status === 403 && r.body?.error?.code === 'FEATURE_NOT_ENABLED', JSON.stringify(r.body));
  check('the refusal does not name the feature', !r.body?.error?.details && !/dashboard/i.test(r.body?.error?.message || ''), JSON.stringify(r.body));

  r = await owner.call('GET', `/api/roles/permissions?companyId=${companyC}`);
  check('the role grid leaves out features the company lacks', r.status === 200
    && !(r.body?.data?.permissions || []).some((p: any) => /^(dashboard|data|access|scope|analyst|playbook)\./.test(p.id))
    && (r.body?.data?.permissions || []).some((p: any) => p.id === 'agent.read'), JSON.stringify((r.body?.data?.permissions || []).map((p: any) => p.id)));

  r = await owner.call('GET', `/api/roles?companyId=${companyC}`);
  check('a new company has its own Member role, following the defaults', r.status === 200
    && r.body?.data?.builtIn?.find((b: any) => b.name === 'USER')?.customized === false, JSON.stringify(r.body?.data?.builtIn));

  r = await alphaUser.call('GET', '/api/auth/me');
  check('a member is only told about features it can use', r.status === 200
    && JSON.stringify(r.body?.data?.user?.features) === JSON.stringify(['dashboards']), JSON.stringify(r.body?.data?.user?.features));

  r = await betaAdmin.call('GET', `/api/roles/${analystRoleId}`);
  check("another company's role is not found", r.status === 404, JSON.stringify(r.body));
  r = await betaAdmin.call('GET', `/api/roles?companyId=${companyA}`);
  check('companyId cannot widen a company caller', r.status === 200 && !(r.body?.data?.custom || []).some((x: any) => x.id === analystRoleId), JSON.stringify(r.body?.data));

  const gate = (uri: string, method: string) => ({ headers: { 'X-Original-URI': uri, 'X-Original-Method': method } });

  const analystChat = '/svc/adk/contexts/no-such-connection/data-analyst/sessions';
  r = await alphaUser.call('GET', '/api/gate/agents', undefined, gate(analystChat, 'POST'));
  check('the agent gate refuses a role without an agent permission', r.status === 403, String(r.status));
  r = await alphaUser.call('GET', '/api/gate/agents', undefined, gate('/svc/adk/health', 'GET'));
  check('the agent gate lets a signed-in account read ADK health', r.status === 204, String(r.status));
  r = await alphaUser.call('GET', '/api/gate/agents', undefined, gate('/svc/mojo/sessions', 'GET'));
  check('the retired Mojo service is refused outright', r.status === 403, String(r.status));

  r = await alphaAdmin.call('PATCH', `/api/users/${alphaUserId}`, { customRoleId: 999999 });
  check('an unknown role cannot be assigned', r.status === 404, JSON.stringify(r.body));
  r = await alphaAdmin.call('PATCH', `/api/users/${alphaUserId}`, { customRoleId: analystRoleId });
  check('a company admin gives a member the role', r.status === 200 && r.body?.data?.customRoleId === analystRoleId, JSON.stringify(r.body));

  r = await alphaUser.call('GET', '/api/auth/me');
  check("the member now holds exactly the role's permissions",
    r.status === 200
      && (r.body?.data?.user?.permissions || []).includes('agent.create')
      && !(r.body?.data?.user?.permissions || []).includes('analyst.use'),
    JSON.stringify(r.body?.data?.user?.permissions));

  r = await alphaUser.call('GET', '/api/gate/agents', undefined, gate('/svc/adk/contexts/no-such-connection/playbook-builder/sessions', 'POST'));
  check('the agent gate refuses an action the role lacks', r.status === 403, String(r.status));
  r = await alphaUser.call('GET', '/api/gate/agents', undefined, { noAuth: true, ...gate(analystChat, 'GET') });
  check('the agent gate refuses an anonymous call with 401', r.status === 401, String(r.status));

  r = await alphaAdmin.call('DELETE', `/api/roles/${analystRoleId}`);
  check('a role still held cannot be deleted', r.status === 409, JSON.stringify(r.body));
  r = await alphaAdmin.call('PATCH', `/api/users/${alphaUserId}`, { customRoleId: null });
  check('the member goes back to the built-in role', r.status === 200 && r.body?.data?.customRoleId === null, JSON.stringify(r.body));
  r = await alphaAdmin.call('DELETE', `/api/roles/${analystRoleId}`);
  check('an unused role is deleted', r.status === 200, JSON.stringify(r.body));

  r = await alphaAdmin.call('PUT', '/api/roles/built-in/COMPANY_ADMIN', { permissions: [] });
  check('the company admin role cannot be changed by a company', r.status === 400, JSON.stringify(r.body));
  r = await alphaAdmin.call('PUT', '/api/roles/built-in/USER', { permissions: ['agent.read'] });
  check('a company admin tailors the Member role', r.status === 200
    && r.body?.data?.builtIn?.find((b: any) => b.name === 'USER')?.customized === true, JSON.stringify(r.body?.data?.builtIn));
  r = await alphaUser.call('GET', '/api/auth/me');
  check('members follow their company\'s Member role', r.status === 200
    && JSON.stringify(r.body?.data?.user?.permissions) === JSON.stringify(['agent.read']), JSON.stringify(r.body?.data?.user?.permissions));
  r = await betaAdmin.call('GET', '/api/roles');
  check('...and only that company', r.status === 200
    && r.body?.data?.builtIn?.find((b: any) => b.name === 'USER')?.customized === false, JSON.stringify(r.body?.data?.builtIn));
  r = await alphaAdmin.call('DELETE', '/api/roles/built-in/USER');
  check('Member resets to the platform defaults', r.status === 200
    && r.body?.data?.builtIn?.find((b: any) => b.name === 'USER')?.customized === false, JSON.stringify(r.body));
  r = await alphaUser.call('GET', '/api/dashboard/default');
  check('the reset restores the defaults', r.status === 200, `${r.status} ${JSON.stringify(r.body?.error)}`);

  section('Audit trail: stored in the database, scoped by role');

  await new Promise((done) => setTimeout(done, 500));

  const inCompany = (item: any, id: number) => item.companyId === id || item.actorCompanyId === id;

  r = await owner.call('GET', '/api/audit?pageSize=100');
  const ownerItems: any[] = r.body?.data?.items || [];
  check('the platform owner reads the whole trail', r.status === 200 && r.body?.data?.scope === 'all', `${r.status} ${r.body?.data?.scope}`);
  check('which spans both companies',
    ownerItems.some((i) => inCompany(i, companyA)) && ownerItems.some((i) => inCompany(i, companyB)));
  check('entries name the company they belong to', ownerItems.some((i) => i.companyName === 'Alpha Industries'));
  check('newest first by default', ownerItems.length < 2 || String(ownerItems[0].ts) >= String(ownerItems[1].ts));

  r = await owner.call('GET', '/api/audit?event=company_created');
  check('the event filter narrows the trail',
    r.status === 200 && r.body?.data?.total === 2 && r.body.data.items.every((i: any) => i.event === 'company_created'),
    JSON.stringify(r.body?.data?.total));

  r = await owner.call('GET', '/api/audit?category=company&pageSize=8');
  const companyEvents: any[] = r.body?.data?.items || [];
  check('the company category leaves out sign-ins',
    r.status === 200 && companyEvents.length > 0
      && companyEvents.every((i) => /^(company_|dashboard_|context_|access_granted|access_revoked)/.test(i.event)),
    JSON.stringify(companyEvents.map((i) => i.event)));
  check('and is filtered by the server, so a page is full even after many sign-ins',
    r.body?.data?.total >= companyEvents.length && companyEvents.length === Math.min(8, r.body?.data?.total));

  r = await owner.call('GET', '/api/audit?category=nonsense');
  check('an unknown category is a validation error', r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR');

  r = await owner.call('GET', '/api/audit?category=lakehouse&pageSize=100');
  check('the lakehouse category holds only Metadata Lakehouse events, never a sign-in',
    r.status === 200 && (r.body?.data?.items || []).every((i: any) => i.event.startsWith('context_')),
    JSON.stringify((r.body?.data?.items || []).map((i: any) => i.event)));

  r = await owner.call('GET', '/api/audit?category=auth&pageSize=100');
  check('the auth category holds the sign-ins',
    r.status === 200 && r.body?.data?.total > 0
      && r.body.data.items.every((i: any) => /^(login_|logout|session_|refresh_|password_|account_)/.test(i.event)));

  r = await owner.call('GET', '/api/audit?action=create&pageSize=100');
  check('the create action matches created/published/granted events only',
    r.status === 200 && r.body?.data?.total > 0
      && r.body.data.items.every((i: any) => /_(created|published|granted|assigned|activated)$/.test(i.event)),
    JSON.stringify((r.body?.data?.items || []).map((i: any) => i.event)));

  r = await owner.call('GET', '/api/audit?action=nonsense');
  check('an unknown action is a validation error', r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR');

  const today = new Date().toISOString().slice(0, 10);
  r = await owner.call('GET', `/api/audit?from=${today}&to=${today}&pageSize=1`);
  check('a date range including today finds today\'s entries', r.status === 200 && r.body?.data?.total > 0);
  r = await owner.call('GET', '/api/audit?from=2000-01-01&to=2000-01-02');
  check('a date range in the past finds nothing', r.status === 200 && r.body?.data?.total === 0);
  r = await owner.call('GET', '/api/audit?from=yesterday');
  check('a malformed date is a validation error', r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR');

  r = await owner.call('GET', '/api/audit?search=Beta%20Corp');
  check('search reaches the company name and the detail',
    r.status === 200 && r.body?.data?.total > 0 && r.body.data.items.every((i: any) => JSON.stringify(i).includes('Beta')),
    JSON.stringify(r.body?.data?.total));

  r = await alphaAdmin.call('GET', '/api/audit?pageSize=100');
  const alphaItems: any[] = r.body?.data?.items || [];
  check('a company administrator reads their company trail', r.status === 200 && r.body?.data?.scope === 'company', `${r.status} ${r.body?.data?.scope}`);
  check('and only their company', alphaItems.length > 0 && alphaItems.every((i) => inCompany(i, companyA)),
    JSON.stringify(alphaItems.find((i) => !inCompany(i, companyA))));

  r = await betaAdmin.call('GET', '/api/audit?pageSize=100');
  check('another company sees none of it',
    r.status === 200 && (r.body?.data?.items || []).every((i: any) => !inCompany(i, companyA)));

  r = await alphaUser.call('GET', '/api/audit?pageSize=100');
  const selfItems: any[] = r.body?.data?.items || [];
  check('a user reads their own trail', r.status === 200 && r.body?.data?.scope === 'self', `${r.status} ${r.body?.data?.scope}`);
  check('what they did and what was done to their account',
    selfItems.length > 0 && selfItems.every((i) => i.actorId === alphaUserId || i.detail?.userId === alphaUserId),
    JSON.stringify(selfItems.find((i) => i.actorId !== alphaUserId && i.detail?.userId !== alphaUserId)));
  check('including a grant made to them by their administrator',
    selfItems.some((i) => i.event === 'access_granted' && i.actor === 'alpha.admin'));

  section('Token lifecycle');

  const before = alphaUser.cookies.get('da_access');
  const beforeCookie = alphaUser.cookies.get('da_refresh');
  r = await alphaUser.call('POST', '/api/auth/refresh');
  check('refresh sets a new access cookie', r.status === 200 && alphaUser.cookies.get('da_access') !== before, JSON.stringify(r.body?.error));
  check('refresh response carries no token', !/token/i.test(Object.keys(r.body?.data || {}).join(',')));
  check('refresh rotates the refresh cookie', alphaUser.cookies.get('da_refresh') !== beforeCookie);
  alphaUser.adopt(r.body.data);

  const thief = client('thief');
  thief.cookies.set('da_refresh', beforeCookie!);
  thief.csrfToken = alphaUser.csrfToken;
  thief.cookies.set('da_csrf', alphaUser.csrfToken!);
  r = await thief.call('POST', '/api/auth/refresh');
  check('a replayed refresh token is rejected', r.status === 401 && r.body?.error?.code === 'INVALID_REFRESH_TOKEN', JSON.stringify(r.body));

  r = await alphaUser.call('POST', '/api/auth/refresh');
  check('reuse detection revokes the whole family', r.status === 401, `${r.status} ${JSON.stringify(r.body)}`);

  r = await alphaUser.call('POST', '/api/auth/login', { identifier: 'alpha.user', password: 'AlphaUser1!' });
  check('user can sign in again after the family was revoked', r.status === 200, JSON.stringify(r.body));
  alphaUser.adopt(r.body.data);

  r = await alphaUser.call('POST', '/api/auth/refresh', undefined, { noCsrf: true, csrf: undefined });
  const noCsrf = await (async () => {
    const headers = { Cookie: alphaUser.cookieHeader() };
    const res = await fetch(BASE + '/api/auth/refresh', { method: 'POST', headers });
    return { status: res.status, body: await res.json().catch(() => null) };
  })();
  check('refresh without the CSRF header is refused', noCsrf.status === 403 && noCsrf.body?.error?.code === 'CSRF_TOKEN_INVALID', JSON.stringify(noCsrf.body));

  const forged = await (async () => {
    const headers = { Cookie: alphaUser.cookieHeader(), 'Content-Type': 'application/json' };
    const res = await fetch(BASE + '/api/auth/change-password', { method: 'POST', headers, body: '{}' });
    return { status: res.status, body: await res.json().catch(() => null) };
  })();
  check('a state-changing call without the CSRF header is refused', forged.status === 403 && forged.body?.error?.code === 'CSRF_TOKEN_INVALID', JSON.stringify(forged.body));

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
  check('admin deactivates their user', r.status === 200 && r.body?.data?.status === 'disabled', JSON.stringify(r.body));

  const disabled = client('disabled');
  r = await disabled.call('POST', '/api/auth/login', { identifier: 'alpha.user', password: 'AlphaUser1!' });
  check('deactivated account cannot sign in', r.status === 403 && r.body?.error?.code === 'ACCOUNT_DISABLED', JSON.stringify(r.body));

  r = await owner.call('PATCH', `/api/platform/companies/${companyA}`, { active: false });
  check('owner deactivates company A', r.status === 200);

  const blocked = client('blocked');
  r = await blocked.call('POST', '/api/auth/login', { identifier: 'alpha.admin', password: 'AlphaAdmin1!' });
  check('a disabled company blocks its administrator', r.status === 403 && r.body?.error?.code === 'COMPANY_DISABLED', JSON.stringify(r.body));

  r = await alphaAdmin.call('GET', '/api/users');
  check('live session in a disabled company is dropped', r.status === 403 && r.body?.error?.code === 'COMPANY_DISABLED', `${r.status} ${JSON.stringify(r.body)}`);

  await owner.call('PATCH', `/api/platform/companies/${companyA}`, { active: true });

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
  check('unknown endpoint is a structured 404', r.status === 404 && r.body?.success === false && r.body?.error?.code === 'RESOURCE_NOT_FOUND');

  r = await owner.call('GET', '/api/platform/users/abc');
  check('a non-numeric id is a validation error', r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR');

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
