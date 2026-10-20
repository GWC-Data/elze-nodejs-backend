import type { Request, Response } from 'express';
import { ok } from '../../shared/http/apiResponse';
import { elapsed } from '../../shared/http/requestTimerMiddleware';
import { requireDraftCard } from './dashboardValidator';
import * as dashboardService from './dashboardService';

async function columns(req: Request, res: Response): Promise<void> {
  ok(res, await dashboardService.describeColumns(req.dashboardId));
  console.log(`[api] GET /api/dashboard/columns ${elapsed(res)}ms`);
}

async function preview(req: Request, res: Response): Promise<void> {
  const draft = requireDraftCard(req.body);
  const result = await dashboardService.previewCard(req.dashboardId, draft);
  console.log(`[api] POST /api/dashboard/preview ${elapsed(res)}ms`);
  ok(res, result);
}

export { columns, preview };
