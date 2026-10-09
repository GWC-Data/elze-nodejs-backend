import type { Request, Response } from 'express';
import { ok } from '../tools/apiResponse';
import { elapsed } from '../middleware/requestTimerMiddleware';
import { parseFilters, requireCardUpdate } from '../validators/dashboardValidator';
import * as dashboardService from '../services/dashboardService';

async function create(req: Request, res: Response): Promise<void> {
  const dashboard = await dashboardService.createDashboard(req.actor, req.body || {});
  console.log(`[api] POST /api/dashboard id=${dashboard.id} company=${dashboard.companyId} ${elapsed(res)}ms`);
  ok(res, dashboard, 201);
}

async function view(req: Request, res: Response): Promise<void> {
  const result = await dashboardService.viewDashboard(req.dashboardId!, parseFilters(req.query), req.dashboardLevel);
  console.log(`[api] GET /api/dashboard/${req.dashboardId} ${elapsed(res)}ms`);
  ok(res, result);
}

async function updateCard(req: Request, res: Response): Promise<void> {
  const update = requireCardUpdate(req.body);
  const result = await dashboardService.updateCard(req.actor, req.dashboardId!, update, req.dashboardLevel);
  console.log(`[api] PATCH /api/dashboard/${req.dashboardId}/config ${elapsed(res)}ms`);
  ok(res, result);
}

async function remove(req: Request, res: Response): Promise<void> {
  const result = await dashboardService.removeDashboard(req.actor, req.params.dashboardId as string);
  console.log(`[api] DELETE /api/dashboard/${req.params.dashboardId} ${elapsed(res)}ms`);
  ok(res, result);
}

export { create, view, updateCard, remove };
