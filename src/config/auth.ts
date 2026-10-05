import './env';
import { required, optional, integer, boolean, ConfigError } from './configError';
import * as appConfig from './appConfig';

const JWT_ACCESS_SECRET = required(
  'JWT_ACCESS_SECRET',
  'it signs access tokens. Anyone holding it can mint a token for any account.'
);
const JWT_REFRESH_SECRET = required(
  'JWT_REFRESH_SECRET',
  'it keys the HMAC that refresh tokens are stored under, so a database dump alone cannot be replayed.'
);

if (JWT_ACCESS_SECRET === JWT_REFRESH_SECRET) {
  throw new ConfigError(
    'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ: sharing one secret means a stolen ' +
    'access token and a stolen refresh token are interchangeable.'
  );
}

const APPLICATION_URL = required(
  'APPLICATION_URL',
  'it is the base address used in onboarding email links, e.g. https://analytics.example.com'
);

let applicationOrigin: URL;
try {
  applicationOrigin = new URL(APPLICATION_URL);
} catch {
  throw new ConfigError(`APPLICATION_URL must be an absolute URL (got "${APPLICATION_URL}")`);
}

const APPLICATION_URL_BASE = APPLICATION_URL.replace(/\/+$/, '');

const ACCESS_TOKEN_TTL_SECONDS = appConfig.ACCESS_TOKEN_TTL_SECONDS;
const REFRESH_TOKEN_TTL_SECONDS = appConfig.REFRESH_TOKEN_TTL_SECONDS;
const ACTIVATION_TOKEN_TTL_SECONDS = appConfig.ACTIVATION_TOKEN_TTL_SECONDS;

const COOKIE_SECURE = boolean('COOKIE_SECURE', applicationOrigin.protocol === 'https:');
const COOKIE_SAMESITE = optional('COOKIE_SAMESITE', 'strict');

const BCRYPT_ROUNDS = integer('BCRYPT_ROUNDS', 10, { min: 8, max: 15 });
const MIN_PASSWORD_LENGTH = integer('MIN_PASSWORD_LENGTH', 8, { min: 8, max: 128 });

const LOGIN_MAX_ATTEMPTS = appConfig.LOGIN_MAX_ATTEMPTS;
const LOGIN_WINDOW_SECONDS = appConfig.LOGIN_WINDOW_SECONDS;
const LOGIN_LOCKOUT_SECONDS = appConfig.LOGIN_LOCKOUT_SECONDS;

function bootstrapSuperAdmin() {
  const { username, email, password } = appConfig.BOOTSTRAP_SUPERADMIN;
  if (!username || !email || !password) {
    throw new ConfigError(
      'BOOTSTRAP_SUPERADMIN in config/appConfig.js needs a username, an email and a password.'
    );
  }
  return { username, email, password };
}

export {
  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
  APPLICATION_URL_BASE as APPLICATION_URL,

  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  ACTIVATION_TOKEN_TTL_SECONDS,

  COOKIE_SECURE,
  COOKIE_SAMESITE,

  BCRYPT_ROUNDS,
  MIN_PASSWORD_LENGTH,

  LOGIN_MAX_ATTEMPTS,
  LOGIN_WINDOW_SECONDS,
  LOGIN_LOCKOUT_SECONDS,

  bootstrapSuperAdmin,
};
