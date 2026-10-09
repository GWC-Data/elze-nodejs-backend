import config from '../config';
import * as userRepository from '../repositories/userRepository';
import { issueActivationToken, activationUrl } from './activationService';
import { sendEmail } from './emailService';
import { assertRoleCompanyPairing } from './roleService';
import { accountActivation } from '../views/templates/accountActivationTemplate';
import { usernameProblem, emailProblem, assertValid } from '../validators/userValidator';
import { fail } from '../tools/AppError';
import { UNIQUE_VIOLATION } from '../constants/pgErrors';
import type { Actor } from '../types/actor';
import type { Queryable } from '../config/pgPool';

const { ACTIVATION_TOKEN_TTL_SECONDS } = config.auth;

interface NewAccountFields {
  companyId?: number | null;
  username: unknown;
  email: unknown;
  displayName?: unknown;
  role: string;
  customRoleId?: number | null;
}

async function createAccount(
  { companyId, username, email, displayName, role, customRoleId = null }: NewAccountFields,
  conn?: Queryable
) {
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
        role,
        customRoleId,
      },
      conn
    );
    return await userRepository.findById(id, conn);
  } catch (err: any) {
    if (err.code === UNIQUE_VIOLATION) {
      throw fail('CONFLICT', 'An account with that username or email already exists.');
    }
    throw err;
  }
}

async function prepareInvitation(
  actor: Actor,
  user: Record<string, any>,
  { companyName = null, conn }: { companyName?: string | null; conn?: Queryable } = {}
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

  let invitation;
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
