import config from '../config';
import * as companyRepository from '../repositories/companyRepository';
import { countDashboards } from './dashboardService';
import { describeTransport } from './emailService';
import { factTotals } from './connectionService';
import type { Actor } from '../types/actor';

const { QUERY_CONCURRENCY } = config.app;
const {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  ACTIVATION_TOKEN_TTL_SECONDS,
  LOGIN_MAX_ATTEMPTS,
  LOGIN_WINDOW_SECONDS,
  LOGIN_LOCKOUT_SECONDS,
  MIN_PASSWORD_LENGTH,
  BCRYPT_ROUNDS,
  COOKIE_SECURE,
  COOKIE_SAMESITE,
} = config.auth;

async function overview(actor: Actor) {
  const [numeric, dashboards, facts] = await Promise.all([
    companyRepository.platformOverview(),
    countDashboards(),
    factTotals(actor),
  ]);
  return {
    ...numeric,
    companiesInactive: numeric.companies - numeric.companiesActive,
    dashboards,
    ...facts,
  };
}

async function settings() {
  return {
    tokens: {
      accessTokenTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTtlSeconds: REFRESH_TOKEN_TTL_SECONDS,
      activationTokenTtlSeconds: ACTIVATION_TOKEN_TTL_SECONDS,
    },
    login: {
      maxAttempts: LOGIN_MAX_ATTEMPTS,
      windowSeconds: LOGIN_WINDOW_SECONDS,
      lockoutSeconds: LOGIN_LOCKOUT_SECONDS,
    },
    password: {
      minLength: MIN_PASSWORD_LENGTH,
      bcryptRounds: BCRYPT_ROUNDS,
    },
    session: {
      cookieSecure: COOKIE_SECURE,
      cookieSameSite: COOKIE_SAMESITE,
    },
    engine: {
      queryConcurrency: QUERY_CONCURRENCY,
      dashboardCount: await countDashboards(),
    },
    email: describeTransport(),
  };
}

export { overview, settings };
