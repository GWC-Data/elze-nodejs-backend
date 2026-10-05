import type { Response } from 'express';

function ok(res: Response, data: unknown, status = 200) {
  const serStart = process.hrtime.bigint();
  const body = JSON.stringify({ success: true, data });
  const serMs = Number(process.hrtime.bigint() - serStart) / 1e6;

  const timings = [`ser;dur=${serMs.toFixed(2)}`];
  if (res.locals.start) timings.unshift(`app;dur=${Date.now() - res.locals.start}`);
  res.set('Server-Timing', timings.join(', '));

  return res.status(status).type('application/json').send(body);
}

export { ok };
