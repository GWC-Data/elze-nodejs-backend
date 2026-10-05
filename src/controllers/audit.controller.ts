import type { Request, Response } from 'express';
import { ok } from '../tools/apiResponse';
import { parseListQuery } from '../validators/list.validator';
import { listEntries } from '../services/audit.service';
import type { AuditListQuery } from '../services/audit.service';
import { AUDIT_SORTS } from '../constants/auditEvents';

async function list(req: Request, res: Response): Promise<void> {
  const query = parseListQuery(req.query, AUDIT_SORTS, { sort: 'ts', dir: 'desc', pageSize: 25 });
  const text = (key: string) => {
    const value = req.query[key];
    return typeof value === 'string' && value ? value : null;
  };
  // TODO(types): sort is always set here because a default sort ('ts') is passed.
  ok(res, await listEntries(req.actor, query as AuditListQuery, {
    event: text('event'),
    category: text('category'),
    action: text('action'),
    from: text('from'),
    to: text('to'),
  }));
}

export { list };
