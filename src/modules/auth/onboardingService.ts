import config from '../../config';
import * as userRepository from '../users/userRepository';
import { issueActivationToken, activationUrl } from './activationService';
import { sendEmail } from '../../shared/email/emailService';
import { assertRoleCompanyPairing } from '../roles/roleService';
import { accountActivation } from './accountActivationTemplate';
import { usernameProblem, emailProblem, assertValid } from '../users/userValidator';
import { fail, present } from '../../shared/errors/AppError';
import { UNIQUE_VIOLATION } from '../../shared/errors/pgErrors';
import { sqlState } from '../../shared/db/dbError';
import type { Actor } from '../../shared/types/actor';
import type { Tx } from '../../shared/db/database';
import type { UserInScopeRow } from '../users/userRepository';

const { ACTIVATION_TOKEN_TTL_SECONDS } = config.auth;

interface NewAccountFields {
  companyId?: number | null;
  username: unknown;
  email: unknown;
  displayName?: unknown;
  role: string;
  roleId: string;
}

async function createAccount({ companyId, username, email, displayName, role, roleId }: NewAccountFields, conn?: Tx) {
  assertRoleCompanyPairing(role, companyId);
  assertValid(usernameProblem(username));
  assertValid(emailProblem(email));

  try {
    const id = await userRepository.insert(
      {
        companyId: companyId ?? null,
        username: String(username).trim(),
        email: String(email).trim().toLowerCase(),
        displayName: displayName ? String(displayName).trim().slice(0, 120) : null,
        roleId,
      },
      conn
    );
    return present(await userRepository.findById(id, conn), 'The new account');
  } catch (err) {
    if (sqlState(err) === UNIQUE_VIOLATION) {
      throw fail('CONFLICT', 'An account with that username or email already exists.');
    }
    throw err;
  }
}

async function prepareInvitation(
  actor: Actor,
  user: UserInScopeRow,
  { companyName = null, conn }: { companyName?: string | null; conn?: Tx } = {}
) {
  const { token } = await issueActivationToken(user.id, actor.id, conn);

  return {
    to: user.email,
    ...accountActivation({
      displayName: user.display_name,
      username: user.username,
      email: user.email,
      companyName: companyName || user.companyName || null,
      activationUrl: activationUrl(token),
      ttlSeconds: ACTIVATION_TOKEN_TTL_SECONDS,
      invitedBy: actor.displayName || actor.username,
    }),
  };
}

async function createAndInvite(actor: Actor, fields: NewAccountFields) {
  const user = await createAccount(fields);

  let invitation: Awaited<ReturnType<typeof prepareInvitation>>;
  try {
    invitation = await prepareInvitation(actor, user);
  } catch (err) {
    await userRepository.remove(user.id);
    throw err;
  }

  try {
    await sendEmail(invitation, { consequence: 'The account was not created.' });
  } catch (err) {
    await userRepository.remove(user.id);
    throw err;
  }

  return user;
}

export { createAccount, prepareInvitation, createAndInvite };
export type { NewAccountFields };
