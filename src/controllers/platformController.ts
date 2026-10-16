import type { Request, Response } from 'express';
import { ok } from '../tools/apiResponse';
import * as platformService from '../services/platformService';
import * as featureService from '../services/featureService';

async function overview(req: Request, res: Response): Promise<void> {
  ok(res, await platformService.overview(req.actor));
}

async function settings(_req: Request, res: Response): Promise<void> {
  ok(res, await platformService.settings());
}

function features(_req: Request, res: Response): void {
  ok(res, featureService.catalogue());
}

export { overview, settings, features };
