import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { fail } from '../errors/AppError';
import { readCsrfCookie } from '../security/cookies';
import { CSRF_HEADER } from '../security/session';

const CSRF_MESSAGE = 'This request could not be verified. Reload the page and try again.';

function requireCsrf(req: Request, _res: Response, next: NextFunction): void {
  const cookie = readCsrfCookie(req);
  const header = req.get(CSRF_HEADER);

  if (!cookie || !header) {
    next(fail('CSRF_TOKEN_INVALID', CSRF_MESSAGE));
    return;
  }

  const a = Buffer.from(String(cookie));
  const b = Buffer.from(String(header));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    next(fail('CSRF_TOKEN_INVALID', CSRF_MESSAGE));
    return;
  }
  next();
}

export { requireCsrf };
