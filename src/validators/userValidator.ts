import config from '../config';
import { fail } from '../tools/AppError';

const { MIN_PASSWORD_LENGTH } = config.auth;

const USERNAME_RE = /^[a-zA-Z0-9._-]{2,50}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > 200) return 'Password must be 200 characters or fewer';
  if (!/[^a-zA-Z]/.test(password)) {
    return 'Password must contain at least one digit or symbol';
  }
  return null;
}

function usernameProblem(username: unknown): string | null {
  const clean = String(username || '').trim();
  if (!USERNAME_RE.test(clean)) {
    return 'Username must be 2-50 characters: letters, digits, dot, underscore or hyphen';
  }
  if (/^\d+$/.test(clean)) return 'Username cannot be entirely numeric';
  return null;
}

function emailProblem(email: unknown): string | null {
  const clean = String(email || '').trim();
  if (!clean) return 'Email is required';
  if (clean.length > 190) return 'Email must be 190 characters or fewer';
  if (!EMAIL_RE.test(clean)) return 'That does not look like an email address';
  return null;
}

function assertValid(problem: string | null | undefined): void {
  if (problem) throw fail('VALIDATION_ERROR', problem);
}

export { passwordProblem, usernameProblem, emailProblem, assertValid };
