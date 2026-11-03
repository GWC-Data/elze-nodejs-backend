import type { Request, Response } from 'express';
import { ok } from '../../shared/http/apiResponse';
import * as workspaceService from './workspaceService';

async function company(req: Request, res: Response): Promise<void> {
  ok(res, await workspaceService.company(req.actor));
}

async function overview(req: Request, res: Response): Promise<void> {
  ok(res, await workspaceService.overview(req.actor));
}

export { company, overview };
