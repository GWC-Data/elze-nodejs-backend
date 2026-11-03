import type { Request, Response } from 'express';
import { ok } from '../../shared/http/apiResponse';
import { bodyOf } from '../../shared/validation/commonValidator';
import * as roleService from './roleService';

function permissions(_req: Request, res: Response): void {
  ok(res, roleService.permissionCatalogue());
}

function assignable(req: Request, res: Response): void {
  ok(res, roleService.assignableRoles(req.actor, req.query.companyId));
}

async function list(_req: Request, res: Response): Promise<void> {
  ok(res, await roleService.listRoles());
}

async function rolePermissions(req: Request, res: Response): Promise<void> {
  ok(res, await roleService.describeRolePermissions(req.params.id as string));
}

async function replacePermissions(req: Request, res: Response): Promise<void> {
  ok(res, await roleService.replaceRolePermissions(req.actor, req.params.id as string, bodyOf(req.body).permissionIds));
}

export { permissions, list, assignable, rolePermissions, replacePermissions };
