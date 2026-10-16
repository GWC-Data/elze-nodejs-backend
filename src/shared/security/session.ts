const ACCESS_COOKIE = 'da_access';
const REFRESH_COOKIE = 'da_refresh';
const CSRF_COOKIE = 'da_csrf';
const CSRF_HEADER = 'x-csrf-token';
const ACCESS_PATH = '/';
const LEGACY_ACCESS_PATH = '/api';
const REFRESH_PATH = '/api/auth';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  CSRF_COOKIE,
  CSRF_HEADER,
  ACCESS_PATH,
  LEGACY_ACCESS_PATH,
  REFRESH_PATH,
  SAFE_METHODS,
};
