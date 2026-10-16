import type { Request, Response } from 'express';
import { ok } from '../../shared/http/apiResponse';
import { isRbacReady, rbacError } from './bootstrapService';
import { describeTransport } from '../../shared/email/emailService';

function health(_req: Request, res: Response): void {
  const ready = isRbacReady();
  res.status(ready ? 200 : 503);
  ok(res, {
    status: ready ? 'ok' : 'starting',
    detail: ready ? null : rbacError(),
    email: describeTransport().provider,
  });
}

export { health };
