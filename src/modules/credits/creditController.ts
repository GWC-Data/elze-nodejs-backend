import type { Request, Response } from 'express';
import { ok } from '../../shared/http/apiResponse';
import { parseListQuery } from '../../shared/validation/listValidator';
import * as creditService from './creditService';

async function me(req: Request, res: Response): Promise<void> {
  ok(res, await creditService.myCredits(req.actor, req.query.companyId));
}

async function rates(_req: Request, res: Response): Promise<void> {
  ok(res, await creditService.listRates());
}

async function updateRate(req: Request, res: Response): Promise<void> {
  ok(res, await creditService.updateRate(req.actor, req.params.action, req.body));
}

async function companies(req: Request, res: Response): Promise<void> {
  const query = parseListQuery(req.query, creditService.COMPANY_SORTS, { sort: 'name', dir: 'asc', pageSize: 15 });
  ok(res, await creditService.listCompanies(query));
}

async function allocate(req: Request, res: Response): Promise<void> {
  ok(res, await creditService.allocate(req.actor, req.params.companyId, req.body), 201);
}

async function overview(req: Request, res: Response): Promise<void> {
  ok(res, await creditService.overview(req.actor, req.query.companyId));
}

async function members(req: Request, res: Response): Promise<void> {
  ok(res, await creditService.members(req.actor, req.query.companyId));
}

async function setLimit(req: Request, res: Response): Promise<void> {
  ok(res, await creditService.setLimit(req.actor, req.params.userId, req.body));
}

async function activity(req: Request, res: Response): Promise<void> {
  const query = parseListQuery(req.query, creditService.LEDGER_SORTS, {
    sort: 'createdAt',
    dir: 'desc',
    pageSize: 15,
  });
  ok(
    res,
    await creditService.activity(req.actor, query, {
      companyId: req.query.companyId,
      userId: req.query.userId,
      kind: req.query.kind,
      action: req.query.action,
    })
  );
}

async function refund(req: Request, res: Response): Promise<void> {
  ok(res, await creditService.refundAgentCharge(req.actor, req.body));
}

export { me, rates, updateRate, companies, allocate, overview, members, setLimit, activity, refund };
