import type { Request, Response } from 'express';
import { ok } from '../../shared/http/apiResponse';
import * as platformService from './platformService';
import * as featureService from './featureService';

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
