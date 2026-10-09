import type { Request, Response } from 'express';
import { ok } from '../tools/apiResponse';
import { elapsed } from '../middleware/requestTimerMiddleware';
import { requireDraftCard } from '../validators/dashboardValidator';
import * as dashboardService from '../services/dashboardService';

async function columns(req: Request, res: Response): Promise<void> {
  ok(res, await dashboardService.describeColumns(req.dashboardId!));
  console.log(`[api] GET /api/dashboard/columns ${elapsed(res)}ms`);
}

async function preview(req: Request, res: Response): Promise<void> {
  const draft = requireDraftCard(req.body);
  const result = await dashboardService.previewCard(req.dashboardId!, draft);
  console.log(`[api] POST /api/dashboard/preview ${elapsed(res)}ms`);
  ok(res, result);
}

export { columns, preview };
