import config from '../config';
import * as userRepository from '../repositories/user.repository';
import { fail } from '../tools/AppError';
import { hashPassword, verifyPassword } from '../tools/password';
import { requireString } from '../validators/common.validator';
import { passwordProblem, assertValid } from '../validators/user.validator';
import { publicUser } from '../views/serializers/user.serializer';
import * as tokens from './token.service';
import * as throttle from './loginThrottle.service';
import { resolveActivationToken, consumeActivationToken } from './activation.service';
import { getRolePermissions } from './role.service';
import { findActor } from './user.service';
import { usableFeatures } from '../constants/features';
import { listAccessibleDashboards } from './access.service';
import { audit, EVENTS } from './audit.service';
import { AUTH_STATE, USER_STATUS } from '../constants/statuses';
import type { Actor } from '../types/actor';
import type { Queryable } from '../config/pgPool';
import type { IssuedRefreshToken } from './token.service';

const { withTransaction } = config.database;
const { ACCESS_TOKEN_TTL_SECONDS } = config.auth;

interface UserRow {
  id: number;
  role: string;
  [key: string]: any;
}
type RequestBody = Record<string, any>;

function stateOf(user: UserRow) {
  return user.must_change_password ? AUTH_STATE.PASSWORD_CHANGE_REQUIRED : AUTH_STATE.AUTHENTICATED;
}

// Same derivation as every request (user.service findActor): custom role, then the company's
// feature ceiling. Reading the role alone here would hand the browser permissions that the
// very next request is refused.
async function sessionPayload(user: UserRow) {
  const found = await findActor(user.id);
  const permissions = found ? found.permissions : await getRolePermissions(user.role);
  return {
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    user: {
      ...publicUser(found ? found.user : user),
      permissions,
      // Only what this account can use - never the rest of the company's features.
      features: found ? usableFeatures(found.features, permissions) : [],
    },
  };
}

function sessionTokens(user: UserRow, refresh: IssuedRefreshToken) {
  return { accessToken: tokens.issueAccessToken(user, refresh.familyId), refreshToken: refresh.token };
}

async function startSession(user: UserRow) {
  const cookies = sessionTokens(user, await tokens.issueRefreshToken(user.id));
  return { cookies, payload: await sessionPayload(user) };
}

async function login(body: RequestBody = {}) {
  const identifier = String(body.identifier || body.username || '').trim();
  const password = String(body.password || '');

  if (!identifier || !password) {
    throw fail('VALIDATION_ERROR', 'Enter your username or email and your password.');
  }

  try {
    await throttle.assertNotLocked(identifier);
  } catch (err) {
    audit(EVENTS.LOGIN_BLOCKED, identifier, { reason: 'rate_limited' });
    throw err;
  }

  const user = await userRepository.findByIdentifier(identifier);
  const passwordOk = user && verifyPassword(password, user.password_hash);

  if (!user || !passwordOk) {
    await throttle.recordFailure(identifier);
    audit(EVENTS.LOGIN_FAILED, identifier, { known: Boolean(user) });
    throw fail('INVALID_CREDENTIALS', 'Incorrect username or password.');
  }

  if (user.status === USER_STATUS.DISABLED) {
    audit(EVENTS.LOGIN_FAILED, identifier, { reason: 'account_disabled' });
    throw fail('ACCOUNT_DISABLED', 'This account has been deactivated. Contact your administrator.');
  }
  if (user.company_id && !user.companyActive) {
    audit(EVENTS.LOGIN_FAILED, identifier, { reason: 'company_disabled' });
    throw fail('COMPANY_DISABLED', 'This company is not currently active. Contact your administrator.');
  }

  await throttle.recordSuccess(identifier);
  await userRepository.recordLogin(user.id);

  const session = await startSession(user);
  audit(EVENTS.LOGIN_SUCCESS, user, { role: user.role, companyId: user.company_id });

  return { cookies: session.cookies, body: { ...session.payload, state: stateOf(user) } };
}

async function refresh(presented: unknown) {
  let row;
  try {
    row = await tokens.consumeRefreshToken(presented);
  } catch (err: any) {
    if (err.code === 'INVALID_REFRESH_TOKEN') {
      audit(EVENTS.SESSION_REVOKED, 'anonymous', { reason: 'invalid_refresh_token' });
    }
    err.endsSession = true;
    throw err;
  }

  const user = await userRepository.findById(row.user_id);

  if (!user || user.status === USER_STATUS.DISABLED || (user.company_id && !user.companyActive)) {
    await tokens.revokeFamily(row.family_id, 'account_unavailable');
    audit(EVENTS.SESSION_REVOKED, user || 'unknown', { reason: 'account_unavailable' });
    const err: any = fail('INVALID_REFRESH_TOKEN', tokens.SESSION_ENDED); // TODO(types): endsSession is an ad-hoc flag read by the error handler
    err.endsSession = true;
    throw err;
  }

  const rotated = await tokens.issueRefreshToken(user.id, { familyId: row.family_id, replaces: row.id });
  const payload = await sessionPayload(user);
  return { cookies: sessionTokens(user, rotated), body: { ...payload, state: stateOf(user) } };
}

async function logout(presented: unknown) {
  if (presented) {
    try {
      const row = await tokens.consumeRefreshToken(presented);
      await tokens.revokeFamily(row.family_id, 'logout');
      audit(EVENTS.LOGOUT, { id: row.user_id, username: null }, { familyId: row.family_id });
    } catch { }
  }
  return { state: AUTH_STATE.UNAUTHENTICATED };
}

async function me(actor: Actor, account: any) {
  const dashboards = actor.mustChangePassword ? [] : await listAccessibleDashboards(actor);
  return {
    state: actor.mustChangePassword ? AUTH_STATE.PASSWORD_CHANGE_REQUIRED : AUTH_STATE.AUTHENTICATED,
    user: { ...account, permissions: actor.permissions, features: usableFeatures(actor.features, actor.permissions) },
    dashboards,
  };
}

async function sessions(actor: Actor) {
  const list = await tokens.listSessions(actor.id);
  return list.map((s: Record<string, any>) => ({ ...s, current: s.familyId === actor.familyId }));
}

async function changePassword(
  actor: Actor,
  { currentPassword, newPassword }: { currentPassword?: any; newPassword?: any } = {}
) {
  const user = await userRepository.findById(actor.id);
  const credentials = await userRepository.findCredentialsById(actor.id);

  if (!verifyPassword(currentPassword, credentials && credentials.password_hash)) {
    throw fail('INVALID_CREDENTIALS', 'Your current password is incorrect.');
  }
  assertValid(passwordProblem(newPassword));
  if (newPassword === currentPassword) {
    throw fail('VALIDATION_ERROR', 'Your new password must differ from the current one.');
  }

  await withTransaction(async (conn: Queryable) => {
    await userRepository.setActivePassword(conn, user.id, hashPassword(newPassword));
    await tokens.revokeAllForUser(user.id, 'password_changed', conn);
  });

  const session = await startSession(await userRepository.findById(user.id));
  audit(EVENTS.PASSWORD_CHANGED, actor, { selfService: true });
  return { cookies: session.cookies, body: { ...session.payload, state: AUTH_STATE.AUTHENTICATED } };
}

async function describeActivation(token: unknown) {
  const row = await resolveActivationToken(token);
  return {
    username: row.username,
    email: row.email,
    displayName: row.display_name || null,
    companyName: row.companyName || null,
  };
}

async function activate(body: RequestBody = {}) {
  const token = requireString(body.token, 'Activation token', { max: 200 });
  const { password } = body;

  assertValid(passwordProblem(password));

  const row = await resolveActivationToken(token);

  await withTransaction(async (conn: Queryable) => {
    await consumeActivationToken(row.id, conn);
    await userRepository.setActivePassword(conn, row.user_id, hashPassword(password));
    await tokens.revokeAllForUser(row.user_id, 'account_activated', conn);
  });

  const user = await userRepository.findById(row.user_id);
  await userRepository.recordLogin(user.id);

  const session = await startSession(user);
  audit(EVENTS.ACCOUNT_ACTIVATED, user, { companyId: user.company_id });
  return { cookies: session.cookies, body: { ...session.payload, state: AUTH_STATE.AUTHENTICATED } };
}

export { login, refresh, logout, me, sessions, changePassword, describeActivation, activate };
