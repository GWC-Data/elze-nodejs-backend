import config from '../config';
import * as companyRepository from '../repositories/company.repository';
import { countDashboards } from './dashboard.service';
import { describeTransport } from './email.service';

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

async function overview() {
  const [numeric, dashboards] = await Promise.all([companyRepository.platformOverview(), countDashboards()]);
  return {
    ...numeric,
    companiesInactive: numeric.companies - numeric.companiesActive,
    dashboards,
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
