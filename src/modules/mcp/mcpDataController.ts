import type { Request, Response } from 'express';
import { ok } from '../../shared/http/apiResponse';
import * as mcpDataService from './mcpDataService';

async function session(req: Request, res: Response): Promise<void> {
  ok(res, await mcpDataService.tokenSession(req.actor, req.mcpTokenId));
}

async function contexts(req: Request, res: Response): Promise<void> {
  ok(res, await mcpDataService.listContexts(req.actor, req.query));
}

async function overview(req: Request, res: Response): Promise<void> {
  ok(res, await mcpDataService.contextOverview(req.actor, req.params, req.query));
}

async function versions(req: Request, res: Response): Promise<void> {
  ok(res, await mcpDataService.contextVersions(req.actor, req.params));
}

async function objects(req: Request, res: Response): Promise<void> {
  ok(res, await mcpDataService.contextObjects(req.actor, req.params, req.query));
}

async function table(req: Request, res: Response): Promise<void> {
  ok(res, await mcpDataService.describeTable(req.actor, req.params, req.query));
}

export { session, contexts, overview, versions, objects, table };
