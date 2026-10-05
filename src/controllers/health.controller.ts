import type { Request, Response } from 'express';
import { ok } from '../tools/apiResponse';
import { isRbacReady, rbacError } from '../services/bootstrap.service';
import { describeTransport } from '../services/email.service';

function health(req: Request, res: Response): void {
  const ready = isRbacReady();
  res.status(ready ? 200 : 503);
  ok(res, {
    status: ready ? 'ok' : 'starting',
    detail: ready ? null : rbacError(),
    email: describeTransport().provider,
  });
}

export { health };
