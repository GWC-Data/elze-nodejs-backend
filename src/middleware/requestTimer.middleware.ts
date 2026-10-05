import type { Request, Response, NextFunction } from 'express';

function requestTimer(req: Request, res: Response, next: NextFunction): void {
  res.locals.start = Date.now();
  next();
}

function elapsed(res: Response): number {
  return Date.now() - res.locals.start;
}

export { requestTimer, elapsed };
