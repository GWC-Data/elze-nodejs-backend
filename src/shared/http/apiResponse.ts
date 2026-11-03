import type { Response } from 'express';

function ok(res: Response, data: unknown, status = 200) {
  if (res.locals.start) res.set('Server-Timing', `app;dur=${Date.now() - res.locals.start}`);
  return res.status(status).json({ success: true, data });
}

export { ok };
