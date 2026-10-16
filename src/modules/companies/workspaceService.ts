import * as companyRepository from './companyRepository';
import { fail } from '../../shared/errors/AppError';
import { requireCompany } from './companyService';
import { countAccessibleDashboards } from '../access/accessService';
import { factTotals } from '../contextLayer/connectionService';
import type { Actor } from '../../shared/types/actor';

function tenantId(actor: Actor): number {
  if (actor.isPlatform) {
    throw fail('TENANT_ACCESS_DENIED', 'A platform account has no workspace of its own. Use the platform console.');
  }
  return actor.companyId as number;
}

async function company(actor: Actor) {
  return requireCompany(actor, tenantId(actor), { counts: true });
}

async function overview(actor: Actor) {
  const companyId = tenantId(actor);
  const [numeric, dashboardsGranted, facts] = await Promise.all([
    companyRepository.workspaceOverview(companyId),
    countAccessibleDashboards(actor),
    factTotals(actor),
  ]);
  return { ...numeric, dashboardsGranted, ...facts };
}

export { company, overview };
