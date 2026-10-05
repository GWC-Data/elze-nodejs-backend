import type { Request, Response } from 'express';
import { ok } from '../tools/apiResponse';
import { requireId } from '../validators/common.validator';
import { parseListQuery } from '../validators/list.validator';
import { publicUser } from '../views/serializers/user.serializer';
import * as userService from '../services/user.service';
import * as scopeService from '../services/scope.service';
import * as accessService from '../services/access.service';

const userId = (req: Request) => requireId(req.params.id, 'user id');

async function options(req: Request, res: Response): Promise<void> {
  ok(res, await userService.listUserOptions(req.actor));
}

async function scopeOptions(req: Request, res: Response): Promise<void> {
  ok(res, await scopeService.scopeOptions());
}

async function list(req: Request, res: Response): Promise<void> {
  const query = parseListQuery(req.query, userService.USER_SORTS, { sort: 'name', pageSize: 15 });
  ok(res, await userService.listUsers(req.actor, query, {
    companyId: req.query.companyId,
    role: req.query.role,
    status: req.query.status,
  }));
}

async function create(req: Request, res: Response): Promise<void> {
  ok(res, await userService.createUser(req.actor, req.body || {}), 201);
}

async function get(req: Request, res: Response): Promise<void> {
  ok(res, publicUser(await userService.requireUserInScope(req.actor, userId(req))));
}

async function update(req: Request, res: Response): Promise<void> {
  ok(res, await userService.updateUser(req.actor, userId(req), req.body || {}));
}

async function deactivate(req: Request, res: Response): Promise<void> {
  ok(res, await userService.deactivateUser(req.actor, userId(req)));
}

async function activate(req: Request, res: Response): Promise<void> {
  ok(res, await userService.activateUser(req.actor, userId(req)));
}

async function reissueActivation(req: Request, res: Response): Promise<void> {
  ok(res, await userService.reissueActivation(req.actor, userId(req)));
}

async function remove(req: Request, res: Response): Promise<void> {
  await userService.deleteUser(req.actor, userId(req));
  ok(res, { deleted: true });
}

async function access(req: Request, res: Response): Promise<void> {
  const user = await userService.requireUserInScope(req.actor, userId(req));
  ok(res, await accessService.listUserGrants(user.id));
}

async function getScope(req: Request, res: Response): Promise<void> {
  const user = await userService.requireUserInScope(req.actor, userId(req));
  ok(res, await scopeService.describeUserScopes(user));
}

async function replaceScope(req: Request, res: Response): Promise<void> {
  const user = await userService.requireUserInScope(req.actor, userId(req));
  ok(res, await scopeService.replaceUserScopes(req.actor, user, (req.body || {}).scopes));
}

export {
  options,
  scopeOptions,
  list,
  create,
  get,
  update,
  deactivate,
  activate,
  reissueActivation,
  remove,
  access,
  getScope,
  replaceScope,
};
