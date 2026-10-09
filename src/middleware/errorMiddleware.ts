import type { Request, Response, NextFunction } from 'express';
import { ERROR_STATUS, SAFE_TO_DISCLOSE, GENERIC_MESSAGE } from '../constants/errorCodes';

interface ErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

function sendError(res: Response, err: any, context: string): void {
  const code: string = err && (ERROR_STATUS as Record<string, number>)[err.code] ? err.code : 'INTERNAL_ERROR';
  const status = (ERROR_STATUS as Record<string, number>)[code];

  if (status >= 500) {
    console.error(`[api] ${context} failed:`, err && err.stack ? err.stack : err);
  }

  const body: ErrorBody = {
    success: false,
    error: {
      code,
      message: SAFE_TO_DISCLOSE.has(code) ? err.message : GENERIC_MESSAGE,
    },
  };
  if (err && err.details !== undefined) body.error.details = err.details;

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

function errorHandler(err: any, req: Request, res: Response, next: NextFunction): void {
  void next;
  sendError(res, err, `${req.method} /api${req.path}`);
}

export { notFound, errorHandler };
