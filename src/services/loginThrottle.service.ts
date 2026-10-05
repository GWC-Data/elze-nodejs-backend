import config from '../config';
import * as loginAttemptRepository from '../repositories/loginAttempt.repository';
import { fail } from '../tools/AppError';

const { LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_SECONDS, LOGIN_LOCKOUT_SECONDS } = config.auth;

function keyFor(identifier: unknown): string {
  return String(identifier || '').trim().toLowerCase().slice(0, 190);
}

async function assertNotLocked(identifier: unknown): Promise<void> {
  const key = keyFor(identifier);
  if (!key) return;

  const lockedUntil = await loginAttemptRepository.lockedUntil(key);
  if (!lockedUntil) return;

  const until = new Date(lockedUntil).getTime();
  if (until <= Date.now()) return;

  const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60000));
  throw fail(
    'RATE_LIMITED',
    `Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
  );
}

async function recordFailure(identifier: unknown): Promise<void> {
  const key = keyFor(identifier);
  if (!key) return;
  await loginAttemptRepository.recordFailure(key, {
    windowSeconds: LOGIN_WINDOW_SECONDS,
    maxAttempts: LOGIN_MAX_ATTEMPTS,
    lockoutSeconds: LOGIN_LOCKOUT_SECONDS,
  });
}

async function recordSuccess(identifier: unknown): Promise<void> {
  const key = keyFor(identifier);
  if (!key) return;
  await loginAttemptRepository.clear(key);
}

const pruneAttempts = loginAttemptRepository.prune;

export { assertNotLocked, recordFailure, recordSuccess, pruneAttempts };
