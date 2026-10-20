import type { Request, Response, NextFunction } from 'express';
import { ERROR_STATUS, SAFE_TO_DISCLOSE, GENERIC_MESSAGE } from '../errors/errorCodes';

interface ErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

interface ErrorLike {
  code?: unknown;
  message?: string;
  details?: unknown;
  stack?: string;
}

function errorLike(err: unknown): ErrorLike {
  return typeof err === 'object' && err !== null ? (err as ErrorLike) : {};
}

function sendError(res: Response, err: unknown, context: string): void {
  const e = errorLike(err);
  const code = typeof e.code === 'string' && ERROR_STATUS[e.code] ? e.code : 'INTERNAL_ERROR';
  const status = ERROR_STATUS[code];

  if (status >= 500) {
    console.error(`[api] ${context} failed:`, e.stack ? e.stack : err);
  }

  const body: ErrorBody = {
    success: false,
    error: {
      code,
      message: SAFE_TO_DISCLOSE.has(code) ? (e.message as string) : GENERIC_MESSAGE,
    },
  };
  if (e.details !== undefined) body.error.details = e.details;

  if (res.headersSent) return;
  res.status(status).json(body);
}

function notFound(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: {
      code: 'RESOURCE_NOT_FOUND',
      message: `Unknown API endpoint: ${req.method} /api${req.path}`,
    },
  });
}

function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  void next;
  sendError(res, err, `${req.method} /api${req.path}`);
}

export { notFound, errorHandler };
