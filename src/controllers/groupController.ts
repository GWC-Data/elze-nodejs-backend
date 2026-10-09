import type { Request, Response } from 'express';
import { ok } from '../tools/apiResponse';
import { requireId } from '../validators/commonValidator';
import * as groupService from '../services/groupService';

const groupId = (req: Request) => requireId(req.params.id, 'group id');

async function list(req: Request, res: Response): Promise<void> {
  ok(res, await groupService.listGroups(req.actor));
}

async function create(req: Request, res: Response): Promise<void> {
  ok(res, await groupService.createGroup(req.actor, req.body || {}), 201);
}

async function get(req: Request, res: Response): Promise<void> {
  ok(res, await groupService.describeGroup(req.actor, groupId(req)));
}

async function update(req: Request, res: Response): Promise<void> {
  ok(res, await groupService.updateGroup(req.actor, groupId(req), req.body || {}));
}

async function remove(req: Request, res: Response): Promise<void> {
  await groupService.deleteGroup(req.actor, groupId(req));
  ok(res, { deleted: true });
}

async function members(req: Request, res: Response): Promise<void> {
  ok(res, await groupService.listMembers(req.actor, groupId(req)));
}

export { list, create, get, update, remove, members };
