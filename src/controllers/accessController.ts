import type { Request, Response } from 'express';
import { ok } from '../tools/apiResponse';
import { requireId } from '../validators/commonValidator';
import * as accessService from '../services/accessService';

const userId = (req: Request) => requireId(req.params.userId, 'user id');
const groupId = (req: Request) => requireId(req.params.groupId, 'group id');
const level = (req: Request) => (req.body || {}).level;

function levels(req: Request, res: Response): void {
  ok(res, accessService.describeLevels());
}

async function dashboards(req: Request, res: Response): Promise<void> {
  ok(res, await accessService.listAccessibleDashboards(req.actor));
}

async function grantable(req: Request, res: Response): Promise<void> {
  ok(res, await accessService.grantableDashboards(req.actor, req.query.companyId));
}

async function grants(req: Request, res: Response): Promise<void> {
  ok(res, await accessService.dashboardGrants(req.actor, req.query.companyId, req.params.dashboardId as string));
}

async function people(req: Request, res: Response): Promise<void> {
  ok(res, await accessService.shareablePeople(req.actor, req.query.companyId, req.params.dashboardId as string));
}

async function grantUser(req: Request, res: Response): Promise<void> {
  const id = userId(req);
  ok(res, await accessService.grantToUser(req.actor, req.params.dashboardId as string, id, level(req)));
}

async function revokeUser(req: Request, res: Response): Promise<void> {
  ok(res, await accessService.revokeFromUser(req.actor, req.params.dashboardId as string, userId(req)));
}

async function grantGroup(req: Request, res: Response): Promise<void> {
  const id = groupId(req);
  ok(res, await accessService.grantToGroup(req.actor, req.params.dashboardId as string, id, level(req)));
}

async function revokeGroup(req: Request, res: Response): Promise<void> {
  ok(res, await accessService.revokeFromGroup(req.actor, req.params.dashboardId as string, groupId(req)));
}

async function groupDashboards(req: Request, res: Response): Promise<void> {
  ok(res, await accessService.groupDashboards(req.actor, groupId(req)));
}

export {
  levels,
  dashboards,
  grantable,
  grants,
  people,
  grantUser,
  revokeUser,
  grantGroup,
  revokeGroup,
  groupDashboards,
};
