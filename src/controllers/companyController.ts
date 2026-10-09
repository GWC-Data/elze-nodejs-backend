import type { Request, Response } from 'express';
import { ok } from '../tools/apiResponse';
import { requireId } from '../validators/commonValidator';
import { parseListQuery } from '../validators/listValidator';
import * as companyService from '../services/companyService';
import * as accessService from '../services/accessService';
import * as featureService from '../services/featureService';

const companyId = (req: Request) => requireId(req.params.id, 'company id');

async function list(req: Request, res: Response): Promise<void> {
  const query = parseListQuery(req.query, companyService.COMPANY_SORTS, { sort: 'name', pageSize: 15 });
  ok(res, await companyService.listCompanies(req.actor, query, { active: req.query.active }));
}

async function options(req: Request, res: Response): Promise<void> {
  ok(res, await companyService.listCompanyOptions(req.actor));
}

async function create(req: Request, res: Response): Promise<void> {
  ok(res, await companyService.createCompany(req.actor, req.body || {}), 201);
}

async function get(req: Request, res: Response): Promise<void> {
  ok(res, await companyService.requireCompany(req.actor, companyId(req), { counts: true }));
}

async function update(req: Request, res: Response): Promise<void> {
  ok(res, await companyService.updateCompany(req.actor, companyId(req), req.body || {}));
}

async function remove(req: Request, res: Response): Promise<void> {
  await companyService.deleteCompany(req.actor, companyId(req));
  ok(res, { deleted: true });
}

async function dashboards(req: Request, res: Response): Promise<void> {
  const id = companyId(req);
  await companyService.requireCompany(req.actor, id);
  ok(res, await accessService.listAssignableDashboards(id));
}

async function assignDashboard(req: Request, res: Response): Promise<void> {
  const id = companyId(req);
  await companyService.requireCompany(req.actor, id);
  ok(res, await accessService.assignDashboard(req.actor, id, req.params.dashboardId as string));
}

async function unassignDashboard(req: Request, res: Response): Promise<void> {
  const id = companyId(req);
  await companyService.requireCompany(req.actor, id);
  ok(res, await accessService.unassignDashboard(req.actor, id, req.params.dashboardId as string));
}

async function features(req: Request, res: Response): Promise<void> {
  const id = companyId(req);
  await companyService.requireCompany(req.actor, id);
  ok(res, await featureService.companyFeatures(id));
}

async function replaceFeatures(req: Request, res: Response): Promise<void> {
  const id = companyId(req);
  await companyService.requireCompany(req.actor, id);
  ok(res, await featureService.replaceCompanyFeatures(req.actor, id, (req.body || {}).features));
}

export {
  list,
  options,
  create,
  get,
  update,
  remove,
  dashboards,
  assignDashboard,
  unassignDashboard,
  features,
  replaceFeatures,
};
