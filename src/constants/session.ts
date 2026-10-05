const ACCESS_COOKIE = 'da_access';
const REFRESH_COOKIE = 'da_refresh';
const CSRF_COOKIE = 'da_csrf';
const CSRF_HEADER = 'x-csrf-token';
// '/' rather than '/api' so the browser also presents it to /svc/* - nginx checks it there
// (routes/gate.routes.ts) and strips every cookie before proxying to the agent services.
const ACCESS_PATH = '/';
// Where the access cookie used to live; cleared on every write so a browser never holds two.
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
