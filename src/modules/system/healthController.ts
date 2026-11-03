import type { Request, Response } from 'express';
import { ok } from '../../shared/http/apiResponse';
import { isRbacReady } from './bootstrapService';
import { describeTransport } from '../../shared/email/emailService';

function health(_req: Request, res: Response): void {
  const ready = isRbacReady();
  ok(
    res,
    {
      status: ready ? 'ok' : 'starting',
      detail: ready ? null : 'The access catalogue is still loading.',
      email: describeTransport().provider,
    },
    ready ? 200 : 503
  );
}

export { health };
