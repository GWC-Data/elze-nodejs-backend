import type { Request, Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import config from '../../config';

const { RATE_LIMIT_PER_MINUTE, AUTH_RATE_LIMIT_PER_15_MIN } = config.http;

const MINUTE_MS = 60 * 1000;

function refuse(message: string) {
  return (_req: Request, res: Response): void => {
    res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message } });
  };
}

function accountKey(req: Request): string {
  const identifier = (req.body as { identifier?: unknown } | undefined)?.identifier;
  if (typeof identifier === 'string' && identifier.trim()) return `account:${identifier.trim().toLowerCase()}`;
  return `ip:${ipKeyGenerator(req.ip ?? '')}`;
}

const requestLimit = rateLimit({
  windowMs: MINUTE_MS,
  limit: RATE_LIMIT_PER_MINUTE,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: refuse('Too many requests. Wait a minute and try again.'),
});

const authLimit = rateLimit({
  windowMs: 15 * MINUTE_MS,
  limit: AUTH_RATE_LIMIT_PER_15_MIN,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: accountKey,
  handler: refuse('Too many attempts. Wait 15 minutes and try again.'),
});

export { requestLimit, authLimit };
