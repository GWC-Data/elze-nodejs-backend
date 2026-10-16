import fs from 'fs';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import config from '../config';
import { CSRF_COOKIE, CSRF_HEADER } from '../constants/session';

const { OPENAPI_FILE } = config.env;

const router = express.Router();

const copyCsrfCookie = new Function(
  'request',
  `const match = document.cookie.match(/(?:^|; )${CSRF_COOKIE}=([^;]*)/);
  if (match) request.headers[${JSON.stringify(CSRF_HEADER)}] = decodeURIComponent(match[1]);
  return request;`
);

function loadSpec(): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(OPENAPI_FILE, 'utf8'));
  } catch (err: any) {
    console.warn(`[docs] API docs are off: cannot read ${OPENAPI_FILE} (${err.message})`);
    return null;
  }
}

const spec = loadSpec();

if (spec) {
  router.get('/openapi.json', (req, res) => {
    res.json(spec);
  });
  router.use(
    '/',
    swaggerUi.serve,
    swaggerUi.setup(spec, {
      customSiteTitle: 'Elze API Reference',
      swaggerOptions: {
        docExpansion: 'list',
        filter: true,
        showExtensions: true,
        defaultModelsExpandDepth: 0,
        withCredentials: true,
        requestInterceptor: copyCsrfCookie,
      },
    })
  );
}

export = router;
