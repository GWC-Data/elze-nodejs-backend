import type { Request, Response } from 'express';
import { ok } from '../tools/apiResponse';
import * as platformService from '../services/platform.service';
import * as featureService from '../services/feature.service';

async function overview(req: Request, res: Response): Promise<void> {
  ok(res, await platformService.overview());
}

async function settings(req: Request, res: Response): Promise<void> {
  ok(res, await platformService.settings());
}

function features(req: Request, res: Response): void {
  ok(res, featureService.catalogue());
}

export { overview, settings, features };
