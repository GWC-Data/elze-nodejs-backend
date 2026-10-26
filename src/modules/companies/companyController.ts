import type { Request, Response } from 'express';
import { ok } from '../../shared/http/apiResponse';
import { bodyOf, optionalFlag, requireUuid } from '../../shared/validation/commonValidator';
import { parseListQuery } from '../../shared/validation/listValidator';
import * as companyService from './companyService';
import * as accessService from '../access/accessService';
import * as featureService from './featureService';

const companyId = (req: Request) => requireUuid(req.params.id, 'company id');

async function list(req: Request, res: Response): Promise<void> {
  const query = parseListQuery(req.query, companyService.COMPANY_SORTS, { sort: 'name', pageSize: 15 });
  ok(res, await companyService.listCompanies(req.actor, query, { active: req.query.active }));
}

async function options(req: Request, res: Response): Promise<void> {
  ok(res, await companyService.listCompanyOptions(req.actor));
}

async function create(req: Request, res: Response): Promise<void> {
  ok(res, await companyService.createCompany(req.actor, bodyOf(req.body)), 201);
}

async function get(req: Request, res: Response): Promise<void> {
  ok(res, await companyService.requireCompany(req.actor, companyId(req), { counts: true }));
}

async function update(req: Request, res: Response): Promise<void> {
  ok(res, await companyService.updateCompany(req.actor, companyId(req), bodyOf(req.body)));
}

async function remove(req: Request, res: Response): Promise<void> {
  const permanent = optionalFlag(req.query.permanent, 'permanent');
  await companyService.deleteCompany(req.actor, companyId(req), { permanent });
  ok(res, { deleted: true, permanent });
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
  ok(res, await featureService.replaceCompanyFeatures(req.actor, id, bodyOf(req.body).featureIds));
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
