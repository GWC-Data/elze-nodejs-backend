import type { Request, Response } from 'express';
import { ok } from '../tools/apiResponse';
import * as companyRoleService from '../services/companyRole.service';

// `?companyId=` / body.companyId only matters for a platform caller; a company account is
// always answered about its own company (resolveTargetCompany ignores anything else).

async function permissions(req: Request, res: Response): Promise<void> {
  ok(res, await companyRoleService.permissionOptions(req.actor, req.query.companyId));
}

async function list(req: Request, res: Response): Promise<void> {
  ok(res, await companyRoleService.listRoles(req.actor, req.query.companyId));
}

async function get(req: Request, res: Response): Promise<void> {
  ok(res, await companyRoleService.getRole(req.actor, req.params.id));
}

async function create(req: Request, res: Response): Promise<void> {
  ok(res, await companyRoleService.createRole(req.actor, req.body || {}), 201);
}

async function update(req: Request, res: Response): Promise<void> {
  ok(res, await companyRoleService.updateRole(req.actor, req.params.id, req.body || {}));
}

async function remove(req: Request, res: Response): Promise<void> {
  await companyRoleService.deleteRole(req.actor, req.params.id);
  ok(res, { deleted: true });
}

async function saveBuiltIn(req: Request, res: Response): Promise<void> {
  ok(res, await companyRoleService.saveBuiltInRole(req.actor, req.params.name, req.body || {}));
}

async function resetBuiltIn(req: Request, res: Response): Promise<void> {
  ok(res, await companyRoleService.resetBuiltInRole(req.actor, req.params.name, req.query.companyId));
}

export { permissions, list, get, create, update, remove, saveBuiltIn, resetBuiltIn };
