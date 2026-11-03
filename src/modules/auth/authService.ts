import config from '../../config';
import * as userRepository from '../users/userRepository';
import { fail, codeOf, present, messageOf } from '../../shared/errors/AppError';
import { hashPassword, verifyPassword } from '../../shared/security/password';
import { requireString } from '../../shared/validation/commonValidator';
import { passwordProblem, assertValid } from '../users/userValidator';
import { publicUser } from '../users/userSerializer';
import * as tokens from './tokenService';
import * as throttle from './loginThrottleService';
import { resolveActivationToken, consumeActivationToken } from './activationService';
import * as resets from './passwordResetService';
import { passwordReset } from './passwordResetTemplate';
import { sendEmail } from '../../shared/email/emailService';
import { findActor } from '../users/userService';
import { usableFeatures, visibleFeatureKeys, visiblePermissionKeys } from '../catalogue/catalogueService';
import { audit, EVENTS } from '../audit/auditService';
import { AUTH_STATE, USER_STATUS } from '../../shared/db/statuses';
import type { Actor } from '../../shared/types/actor';
import type { Tx } from '../../shared/db/database';
import type { IssuedRefreshToken } from './tokenService';
import type { PublicUser, UserSource } from '../users/userSerializer';
import type { LoginUserRow } from '../users/userRepository';

const { withTransaction } = config.database;
const { ACCESS_TOKEN_TTL_SECONDS, PASSWORD_RESET_TOKEN_TTL_SECONDS } = config.auth;

const RESET_REQUESTED = 'If an account matches, we have emailed it a link to choose a new password.';

type RequestBody = Record<string, unknown>;

function endingSession<E>(err: E): E {
  if (typeof err === 'object' && err !== null) Object.assign(err, { endsSession: true });
  return err;
}

function endsSession(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'endsSession' in err && Boolean(err.endsSession);
}

function stateOf(user: { must_change_password: boolean }) {
  return user.must_change_password ? AUTH_STATE.PASSWORD_CHANGE_REQUIRED : AUTH_STATE.AUTHENTICATED;
}

function shownAccess(features: readonly string[], permissions: readonly string[]) {
  return {
    permissions: visiblePermissionKeys(permissions),
    features: visibleFeatureKeys(usableFeatures(features, permissions)),
  };
}

async function sessionPayload(user: UserSource) {
  const found = await findActor(user.id);
  return {
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    user: {
      ...publicUser(found ? found.user : user),
      ...(found ? shownAccess(found.features, found.permissions) : { permissions: [], features: [] }),
    },
  };
}

function sessionTokens(user: UserSource, refresh: IssuedRefreshToken) {
  return {
    accessToken: tokens.issueAccessToken(user, refresh.familyId),
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
  };
}

async function startSession(user: UserSource) {
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
  let row: Awaited<ReturnType<typeof tokens.consumeRefreshToken>>;
  try {
    row = await tokens.consumeRefreshToken(presented);
  } catch (err) {
    if (codeOf(err) === 'INVALID_REFRESH_TOKEN') {
      audit(EVENTS.SESSION_REVOKED, 'anonymous', { reason: 'invalid_refresh_token' });
    }
    throw endingSession(err);
  }

  const user = await userRepository.findById(row.user_id);

  if (!user || user.status === USER_STATUS.DISABLED || (user.company_id && !user.companyActive)) {
    await tokens.revokeFamily(row.family_id, 'account_unavailable');
    audit(EVENTS.SESSION_REVOKED, user || 'unknown', { reason: 'account_unavailable' });
    throw endingSession(fail('INVALID_REFRESH_TOKEN', tokens.SESSION_ENDED));
  }

  const rotated = await tokens.issueRefreshToken(user.id, {
    familyId: row.family_id,
    replaces: row.id,
    notAfter: new Date(row.expires_at),
  });
  const payload = await sessionPayload(user);
  return { cookies: sessionTokens(user, rotated), body: { ...payload, state: stateOf(user) } };
}

async function logout(presented: unknown) {
  if (presented) {
    try {
      const row = await tokens.consumeRefreshToken(presented);
      await tokens.revokeFamily(row.family_id, 'logout');
      audit(EVENTS.LOGOUT, { id: row.user_id, username: null }, { familyId: row.family_id });
    } catch {}
  }
  return { state: AUTH_STATE.UNAUTHENTICATED };
}

async function me(actor: Actor, account: PublicUser) {
  return {
    state: actor.mustChangePassword ? AUTH_STATE.PASSWORD_CHANGE_REQUIRED : AUTH_STATE.AUTHENTICATED,
    user: { ...account, ...shownAccess(actor.features, actor.permissions) },
  };
}

async function sessions(actor: Actor) {
  const list = await tokens.listSessions(actor.id);
  return list.map((s) => ({ ...s, current: s.familyId === actor.familyId }));
}

async function changePassword(
  actor: Actor,
  { currentPassword, newPassword }: { currentPassword?: unknown; newPassword?: unknown } = {}
) {
  const user = await userRepository.findById(actor.id);
  const credentials = await userRepository.findCredentialsById(actor.id);

  if (!verifyPassword(currentPassword, credentials?.password_hash)) {
    throw fail('INVALID_CREDENTIALS', 'Your current password is incorrect.');
  }
  assertValid(passwordProblem(newPassword));
  if (newPassword === currentPassword) {
    throw fail('VALIDATION_ERROR', 'Your new password must differ from the current one.');
  }

  const userId = present(user, 'The signed-in account').id;
  await withTransaction(async (conn: Tx) => {
    await userRepository.setActivePassword(conn, userId, hashPassword(newPassword));
    await tokens.revokeAllForUser(userId, 'password_changed', conn);
    await resets.retireResetTokens(userId, conn);
  });

  const session = await startSession(present(await userRepository.findById(userId), 'The signed-in account'));
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

  await withTransaction(async (conn: Tx) => {
    await consumeActivationToken(row.id, conn);
    await userRepository.setActivePassword(conn, row.user_id, hashPassword(password));
    await tokens.revokeAllForUser(row.user_id, 'account_activated', conn);
  });

  const user = present(await userRepository.findById(row.user_id), 'The activated account');
  await userRepository.recordLogin(user.id);

  const session = await startSession(user);
  audit(EVENTS.ACCOUNT_ACTIVATED, user, { companyId: user.company_id });
  return { cookies: session.cookies, body: { ...session.payload, state: AUTH_STATE.AUTHENTICATED } };
}

function resetRefusal(user: LoginUserRow): string | null {
  if (user.status === USER_STATUS.DISABLED) return 'account_disabled';
  if (user.status !== USER_STATUS.ACTIVE || !user.password_hash) return 'account_not_activated';
  if (user.company_id && !user.companyActive) return 'company_disabled';
  return null;
}

async function deliverResetLink(identifier: string): Promise<void> {
  const user = await userRepository.findByIdentifier(identifier);
  if (!user) {
    audit(EVENTS.PASSWORD_RESET_REQUESTED, identifier, { known: false, sent: false });
    return;
  }

  const target = { userId: user.id, companyId: user.company_id };
  const refusal = resetRefusal(user);
  if (refusal) {
    audit(EVENTS.PASSWORD_RESET_REQUESTED, identifier, { ...target, sent: false, reason: refusal });
    return;
  }
  if (!(await resets.hasResetAllowance(user.id))) {
    audit(EVENTS.PASSWORD_RESET_REQUESTED, identifier, { ...target, sent: false, reason: 'account_limit' });
    return;
  }

  const { token } = await resets.issueResetToken(user.id);
  await sendEmail({
    to: user.email,
    ...passwordReset({
      displayName: user.display_name,
      username: user.username,
      companyName: user.companyName || null,
      resetUrl: resets.resetUrl(token),
      ttlSeconds: PASSWORD_RESET_TOKEN_TTL_SECONDS,
    }),
  });
  audit(EVENTS.PASSWORD_RESET_REQUESTED, identifier, { ...target, sent: true });
}

async function forgotPassword(body: RequestBody = {}) {
  const identifier = requireString(body.identifier || body.email || body.username, 'Username or email', { max: 254 });

  try {
    await resets.assertResetRequestAllowed(identifier);
  } catch (err) {
    audit(EVENTS.PASSWORD_RESET_REQUESTED, identifier, { sent: false, reason: 'rate_limited' });
    throw err;
  }
  await resets.recordResetRequest(identifier);

  void deliverResetLink(identifier).catch((err: unknown) => {
    console.error(`[auth] password reset link for "${identifier}" was not sent: ${messageOf(err)}`);
  });

  return { message: RESET_REQUESTED };
}

async function describePasswordReset(token: unknown) {
  const row = await resets.resolveResetToken(token);
  return {
    username: row.username,
    email: row.email,
    displayName: row.display_name || null,
    companyName: row.companyName || null,
  };
}

async function resetPassword(body: RequestBody = {}) {
  const token = requireString(body.token, 'Reset token', { max: 200 });
  const { password } = body;

  assertValid(passwordProblem(password));

  const row = await resets.resolveResetToken(token);

  await withTransaction(async (conn: Tx) => {
    await resets.consumeResetToken(row.id, conn);
    await userRepository.setActivePassword(conn, row.user_id, hashPassword(password));
    await tokens.revokeAllForUser(row.user_id, 'password_reset', conn);
  });

  const user = present(await userRepository.findById(row.user_id), 'The account');
  await Promise.all([throttle.recordSuccess(user.username), throttle.recordSuccess(user.email)]);
  await userRepository.recordLogin(user.id);

  const session = await startSession(user);
  audit(EVENTS.PASSWORD_RESET, user, { userId: user.id, companyId: user.company_id });
  return { cookies: session.cookies, body: { ...session.payload, state: AUTH_STATE.AUTHENTICATED } };
}

export {
  login,
  refresh,
  logout,
  me,
  sessions,
  changePassword,
  describeActivation,
  activate,
  forgotPassword,
  describePasswordReset,
  resetPassword,
  endsSession,
};
