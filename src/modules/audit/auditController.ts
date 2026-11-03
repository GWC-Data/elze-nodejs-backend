import type { Request, Response } from 'express';
import { ok } from '../../shared/http/apiResponse';
import { parseListQuery } from '../../shared/validation/listValidator';
import { listEntries } from './auditService';
import type { AuditListQuery } from './auditService';
import { AUDIT_SORTS } from './auditEvents';

async function list(req: Request, res: Response): Promise<void> {
  const query = parseListQuery(req.query, AUDIT_SORTS, { sort: 'ts', dir: 'desc', pageSize: 25 });
  const text = (key: string) => {
    const value = req.query[key];
    return typeof value === 'string' && value ? value : null;
  };
  ok(
    res,
    await listEntries(req.actor, query as AuditListQuery, {
      event: text('event'),
      category: text('category'),
      action: text('action'),
      from: text('from'),
      to: text('to'),
    })
  );
}

export { list };
