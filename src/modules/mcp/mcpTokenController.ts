import type { Request, Response } from 'express';
import { ok } from '../../shared/http/apiResponse';
import * as mcpTokenService from './mcpTokenService';

async function list(req: Request, res: Response): Promise<void> {
  ok(res, await mcpTokenService.listTokens(req.actor, req.query.userId));
}

async function create(req: Request, res: Response): Promise<void> {
  const issued = await mcpTokenService.createToken(req.actor, req.body);
  res.set('Cache-Control', 'no-store');
  ok(res, issued, 201);
}

async function revoke(req: Request, res: Response): Promise<void> {
  ok(res, await mcpTokenService.revokeToken(req.actor, req.params.id));
}

async function revokeAll(req: Request, res: Response): Promise<void> {
  ok(res, await mcpTokenService.revokeAllTokens(req.actor, req.body));
}

export { list, create, revoke, revokeAll };
