import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { fail } from '../tools/AppError';
import { readCsrfCookie } from '../tools/cookies';
import { CSRF_HEADER } from '../constants/session';

const CSRF_MESSAGE = 'This request could not be verified. Reload the page and try again.';

function requireCsrf(req: Request, res: Response, next: NextFunction): void {
  const cookie = readCsrfCookie(req);
  const header = req.get(CSRF_HEADER);

  if (!cookie || !header) {
    return next(fail('CSRF_TOKEN_INVALID', CSRF_MESSAGE));
  }

  const a = Buffer.from(String(cookie));
  const b = Buffer.from(String(header));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return next(fail('CSRF_TOKEN_INVALID', CSRF_MESSAGE));
  }
  next();
}

export { requireCsrf };
