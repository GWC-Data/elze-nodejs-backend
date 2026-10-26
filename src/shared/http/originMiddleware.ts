import type { Request, Response, NextFunction } from 'express';
import config from '../../config';
import { fail } from '../errors/AppError';

const { APPLICATION_ORIGIN } = config.auth;
const { IS_PRODUCTION } = config.env;

function requestOrigin(req: Request): string | null {
  const origin = req.get('origin');
  if (origin) return origin;
  const referer = req.get('referer');
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return referer;
  }
}

function isOwnOrigin(req: Request, origin: string): boolean {
  return origin === `${req.protocol}://${req.get('host')}`;
}

function requireApplicationOrigin(req: Request, _res: Response, next: NextFunction): void {
  const origin = requestOrigin(req);
  if (origin === null || origin === APPLICATION_ORIGIN || (!IS_PRODUCTION && isOwnOrigin(req, origin))) {
    next();
    return;
  }
  next(fail('ORIGIN_NOT_ALLOWED', `This API only serves ${APPLICATION_ORIGIN}.`));
}

export { requireApplicationOrigin };
