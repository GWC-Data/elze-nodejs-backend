import type { Request, Response } from 'express';
import { ok } from '../tools/apiResponse';
import * as roleService from '../services/roleService';

function permissions(req: Request, res: Response): void {
  ok(res, roleService.permissionCatalogue());
}

async function list(req: Request, res: Response): Promise<void> {
  ok(res, await roleService.listRoles());
}

async function rolePermissions(req: Request, res: Response): Promise<void> {
  ok(res, await roleService.describeRolePermissions(req.params.name as string));
}

async function replacePermissions(req: Request, res: Response): Promise<void> {
  ok(res, await roleService.replaceRolePermissions(req.actor, req.params.name as string, (req.body || {}).permissions));
}

export { permissions, list, rolePermissions, replacePermissions };
