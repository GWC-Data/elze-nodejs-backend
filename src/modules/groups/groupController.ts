import type { Request, Response } from 'express';
import { ok } from '../../shared/http/apiResponse';
import { bodyOf, optionalFlag, requireUuid } from '../../shared/validation/commonValidator';
import * as groupService from './groupService';

const groupId = (req: Request) => requireUuid(req.params.id, 'group id');

async function list(req: Request, res: Response): Promise<void> {
  ok(res, await groupService.listGroups(req.actor));
}

async function create(req: Request, res: Response): Promise<void> {
  ok(res, await groupService.createGroup(req.actor, bodyOf(req.body)), 201);
}

async function get(req: Request, res: Response): Promise<void> {
  ok(res, await groupService.describeGroup(req.actor, groupId(req)));
}

async function update(req: Request, res: Response): Promise<void> {
  ok(res, await groupService.updateGroup(req.actor, groupId(req), bodyOf(req.body)));
}

async function remove(req: Request, res: Response): Promise<void> {
  const permanent = optionalFlag(req.query.permanent, 'permanent');
  await groupService.deleteGroup(req.actor, groupId(req), { permanent });
  ok(res, { deleted: true, permanent });
}

async function members(req: Request, res: Response): Promise<void> {
  ok(res, await groupService.listMembers(req.actor, groupId(req)));
}

async function contexts(req: Request, res: Response): Promise<void> {
  ok(res, await groupService.listGroupContexts(req.actor, groupId(req)));
}

export { list, create, get, update, remove, members, contexts };
