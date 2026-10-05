import * as companyRepository from '../repositories/company.repository';
import { fail } from '../tools/AppError';
import { requireCompany } from './company.service';
import { countAccessibleDashboards } from './access.service';
import type { Actor } from '../types/actor';

function tenantId(actor: Actor): number {
  if (actor.isPlatform) {
    throw fail(
      'TENANT_ACCESS_DENIED',
      'A platform account has no workspace of its own. Use the platform console.'
    );
  }
  return actor.companyId as number;
}

async function company(actor: Actor) {
  return requireCompany(actor, tenantId(actor), { counts: true });
}

async function overview(actor: Actor) {
  const companyId = tenantId(actor);
  const [numeric, dashboardsGranted] = await Promise.all([
    companyRepository.workspaceOverview(companyId),
    countAccessibleDashboards(actor),
  ]);
  return { ...numeric, dashboardsGranted };
}

export { company, overview };
